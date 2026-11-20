import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { readCheckout } from './checkout.js'
import type { ServiceControl } from './control.js'
import { recordOf, type UpdateRecord, type UpdateStep } from './model.js'
import { busyChains } from './settle.js'
import { runSteps, StepError, type StepPlan } from './steps.js'

/**
 * What the service hands the update process (`plan.json`). The process is the compiled `dist/src/updates/` copied out
 * of the checkout, so the checkout, `npm ci` and the build never touch the code running them; it imports only `node:*`
 * and its own folder.
 */
export interface UpdatePlan extends StepPlan {
  root: string
  /** The data folder (`logs/` is in it): the working folder for a package, whose own folder npm replaces. */
  home: string
  /** The release or commit to run; older rebuilds had no target. */
  target: { version: string; tag: string } | null
  from: UpdateRecord['from']
  service: Pick<ServiceControl, 'stop' | 'start'>
  /** `/api/state` of the service. */
  state: string
  /** `startedAt` of the service before the update: the answer must come from a later start. */
  startedAt: string | null
  /** The previous hub predates hubCommit in /api/state. */
  legacyRollback?: boolean
  settleMs: number
  answerMs: number
  /** How long the answer must hold: a service crashing in a loop answers once and goes. */
  steadyMs: number
  log: string
  result: string
  /** Also print the log: a rebuild runs in the foreground of the CI's SSH call. */
  echo?: boolean
  /**
   * A machine of a hub (BTN-1275): it builds without the page (`build:machine`) and has no `/api/state`, so the answer
   * is a `contactAt` in its `machine-link.json` newer than this run, written once the hub took its handshake.
   */
  machine?: { contact: string }
}

export const ANSWER_MS = 120_000
export const STEADY_MS = 10_000
export const SETTLE_MS = 300_000
const POLL_MS = 2_000
const SETTLE_POLL_MS = 5_000
const OUTPUT_CHARS = 4_000

export const LOG_FILE = join('logs', 'update.log')
export const RESULT_FILE = join('logs', 'update.json')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

class Runner {
  private readonly began = Date.now()

  constructor(private readonly plan: UpdatePlan) {}

  log(line: string): void {
    mkdirSync(dirname(this.plan.log), { recursive: true })
    appendFileSync(this.plan.log, `${new Date().toISOString()} ${line}\n`)
    if (this.plan.echo === true) console.log(line)
  }

  async act(step: UpdateStep, rollback: boolean): Promise<void> {
    const { plan } = this
    this.log(`${rollback ? 'rollback: ' : ''}${step}`)
    switch (step) {
      case 'settle':
        return this.settle()
      case 'stop':
        if (plan.mode === 'rebuild') await this.checkRebuildCheckout()
        return this.run(plan.service.stop)
      case 'start':
        return this.run(plan.service.start)
      case 'fetch':
        // The hub's commit may be on any remote of the machine's checkout.
        return this.run(plan.mode === 'follow' ? ['git', 'fetch', '--all', '--tags'] : ['git', 'fetch', '--tags'])
      case 'checkout':
        // Following the hub leaves the branch where it was: its commits stay, and a rollback puts HEAD back on it.
        return this.run(plan.mode === 'follow' ? ['git', 'checkout', '--detach', plan.target!.tag] : this.checkout(plan.target!.tag))
      case 'restore':
        if (plan.mode === 'rebuild') await this.checkRebuildCheckout()
        return this.run(plan.package === undefined ? this.checkout(plan.from.commit) : this.installPackage(plan.from.version))
      case 'install':
        if (plan.package !== undefined) return this.run(this.installPackage(plan.target!.version))
        if (rollback && plan.mode === 'rebuild') return this.run(npm('ci', '--no-audit', '--no-fund'))
        if (plan.install === null && !dependenciesChanged(plan.root)) return this.log('package-lock.json did not change, nothing to install')
        return this.run(npm(plan.install === 'install' ? 'install' : 'ci', '--no-audit', '--no-fund'))
      case 'build':
        return this.run(npm('run', plan.machine === undefined ? 'build' : 'build:machine'))
      case 'answer':
        if (plan.machine !== undefined) return this.contact(plan.machine.contact, rollback)
        return this.answer(rollback)
      case 'launch':
        return
    }
  }

  /** The wait for chains or for an answer can outlast the green commit this run was called for. */
  private async checkRebuildCheckout(): Promise<void> {
    const checkout = await readCheckout(this.plan.root)
    if (checkout === null || checkout.dirty || checkout.commit !== this.plan.target?.tag || checkout.branch !== this.plan.from.branch) {
      throw new StepError('The checkout changed during the rebuild')
    }
  }

  /** A branch the checkout was on moves with it, so a `git pull` by hand still works; a detached HEAD stays detached. */
  private checkout(to: string): string[] {
    const { branch } = this.plan.from
    return branch === null ? ['git', 'checkout', '--detach', to] : ['git', 'checkout', '-B', branch, to]
  }

  /** The version into the prefix the package is in, so the service's path to it stays. */
  private installPackage(version: string): string[] {
    const { name, prefix } = this.plan.package!
    return npm('install', '--global', '--prefix', prefix, `${name}@${version}`, '--no-audit', '--no-fund')
  }

  private run(argv: string[]): Promise<void> {
    const [command, ...args] = argv
    this.log(`$ ${argv.join(' ')}`)
    return new Promise((resolve, reject) => {
      let output = ''
      const cwd = workingDir(this.plan)
      const child = spawn(command!, args, { cwd, windowsHide: true, shell: process.platform === 'win32' && command === 'npm' })
      const take = (chunk: Buffer) => {
        const text = chunk.toString()
        appendFileSync(this.plan.log, text)
        output = (output + text).slice(-OUTPUT_CHARS)
      }
      child.stdout.on('data', take)
      child.stderr.on('data', take)
      child.on('error', (error) => reject(new StepError(`${argv.join(' ')}: ${error.message}`)))
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new StepError(`${argv.join(' ')} exited with code ${code}\n${output.trim()}`))
      })
    })
  }

  private async state(): Promise<Record<string, unknown>> {
    const response = await fetch(this.plan.state, { signal: AbortSignal.timeout(5_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return (await response.json()) as Record<string, unknown>
  }

  /** Until no unpaused chain is in a launch, a handover or a closing; an unreachable service is not waited for. */
  private async settle(): Promise<void> {
    const deadline = Date.now() + this.plan.settleMs
    while (Date.now() < deadline) {
      let busy: string[]
      try {
        const chain = (await this.state()).chain as { active?: Parameters<typeof busyChains>[0] } | undefined
        busy = busyChains(chain?.active ?? [], new Date())
      } catch {
        return
      }
      if (busy.length === 0) return
      this.log(`waiting for ${busy.join(', ')} to settle`)
      await sleep(SETTLE_POLL_MS)
    }
    this.log(`chains did not settle in ${this.plan.settleMs / 1000} s, going on`)
  }

  /**
   * The hub took the machine's handshake after this run began: its version is the hub's. A rollback brings back the
   * version the hub refused, so it waits for nothing.
   */
  private async contact(file: string, rollback: boolean): Promise<void> {
    if (rollback) return this.log('the version the hub refuses runs again, no contact is waited for')
    const deadline = Date.now() + this.plan.answerMs
    let last = 'no contact'
    while (Date.now() < deadline) {
      try {
        const { contactAt } = JSON.parse(readFileSync(file, 'utf8')) as { contactAt?: unknown }
        if (typeof contactAt === 'number' && contactAt > this.began) {
          this.log(`the hub took the machine at ${new Date(contactAt).toISOString()}`)
          return
        }
      } catch (error) {
        last = error instanceof Error ? error.message : String(error)
      }
      await sleep(POLL_MS)
    }
    throw new StepError(`the hub took no handshake of the machine in ${this.plan.answerMs / 1000} s (${file}): ${last}`)
  }

  /** A later start of the expected version and, for a rebuild, commit, still answering after steadyMs. */
  private async answer(rollback: boolean): Promise<void> {
    const { plan } = this
    const version = rollback ? plan.from.version : (plan.target?.version ?? null)
    const commit = plan.mode === 'rebuild' ? (rollback ? plan.from.commit : plan.target?.tag) : undefined
    const deadline = Date.now() + plan.answerMs
    let last = 'no answer'
    while (Date.now() < deadline) {
      try {
        const state = await this.state()
        const current = (state.updates as { current?: unknown } | undefined)?.current
        const startedAt = state.startedAt
        if (typeof startedAt !== 'string' || startedAt === plan.startedAt) last = 'no new service start yet'
        else if (version !== null && current !== version) last = `it answers with version ${String(current)}`
        else if (commit !== undefined && state.hubCommit !== commit && !(rollback && plan.legacyRollback && state.hubCommit === undefined)) {
          last = `it answers with commit ${String(state.hubCommit)}, expected ${commit}`
        } else {
          await sleep(plan.steadyMs)
          if ((await this.state()).startedAt === startedAt) {
            this.log(`the service answers with ${String(current)}`)
            return
          }
          last = 'it restarted right after its answer'
        }
      } catch (error) {
        last = error instanceof Error ? error.message : String(error)
      }
      await sleep(POLL_MS)
    }
    throw new StepError(`the service did not answer${version === null ? '' : ` with ${version}`} at ${plan.state} in ${plan.answerMs / 1000} s: ${last}`)
  }
}

/** A checkout's commands run in it; a package's folder is replaced by npm, which a process inside it would hold on Windows. */
export function workingDir(plan: Pick<UpdatePlan, 'root' | 'home' | 'package'>): string {
  return plan.package === undefined ? plan.root : plan.home
}

/** npm through the node running this process: the service's PATH may lack it; a shell only for the `npm.cmd` fallback. */
export function npm(...args: string[]): string[] {
  const base = dirname(process.execPath)
  const cli = [join(base, 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(base, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].find((path) => existsSync(path))
  return cli === undefined ? ['npm', ...args] : [process.execPath, cli, ...args]
}

export function readRecord(file: string): UpdateRecord | null {
  try {
    return recordOf(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

/** Writes the record whole: the service reads it at its start, maybe while this process still writes. */
export function writeRecord(file: string, record: UpdateRecord): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(`${file}.tmp`, `${JSON.stringify(record, null, 2)}\n`)
  renameSync(`${file}.tmp`, file)
}

/** Runs the plan, writes the record and the log; exits 1 when the update failed, rolled back or not. */
export async function runPlan(plan: UpdatePlan): Promise<UpdateRecord> {
  const runner = new Runner(plan)
  const startedAt = new Date().toISOString()
  runner.log(`${plan.mode} from ${plan.from.version} (${plan.from.commit})${plan.target === null ? '' : ` to ${plan.target.tag}`}, pid ${process.pid}`)
  const outcome = await runSteps(plan, (step, rollback) => runner.act(step, rollback))
  const record: UpdateRecord = { mode: plan.mode, from: plan.from, to: plan.target, startedAt, finishedAt: new Date().toISOString(), ...outcome, seen: false }
  writeRecord(plan.result, record)
  if (outcome.failed === null) runner.log(`${plan.mode} done`)
  else {
    const back = outcome.rollback === null ? 'nothing to roll back' : outcome.rollback.failed === null ? 'rolled back' : `the rollback failed at ${outcome.rollback.failed.step}`
    runner.log(`${plan.mode} failed at ${outcome.failed.step}; ${back}`)
  }
  return record
}

/** The plan file the service wrote. */
export function readPlan(file: string): UpdatePlan {
  return JSON.parse(readFileSync(file, 'utf8')) as UpdatePlan
}

/** `node_modules` installed before `package-lock.json` last changed: a rebuild installs first. */
export function dependenciesChanged(root: string): boolean {
  const installed = join(root, 'node_modules', '.package-lock.json')
  return !existsSync(installed) || statSync(join(root, 'package-lock.json')).mtimeMs > statSync(installed).mtimeMs
}
