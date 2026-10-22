import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ServiceControl } from './control.js'
import type { UpdateRecord, UpdateStep } from './model.js'
import { busyChains } from './settle.js'
import { runSteps, StepError, type StepPlan } from './steps.js'

/**
 * What the service hands the update process (`plan.json`). The process is the compiled `dist/updates/` copied out of
 * the checkout, so the checkout, `npm ci` and the build never touch the code running them; it imports only `node:*`
 * and its own folder.
 */
export interface UpdatePlan extends StepPlan {
  root: string
  /** The release checked out; `null` for a rebuild. */
  target: { version: string; tag: string } | null
  from: UpdateRecord['from']
  service: Pick<ServiceControl, 'stop' | 'start'>
  /** `/api/state` of the service. */
  state: string
  /** `startedAt` of the service before the update: the answer must come from a later start. */
  startedAt: string | null
  settleMs: number
  answerMs: number
  /** How long the answer must hold: a service crashing in a loop answers once and goes. */
  steadyMs: number
  log: string
  result: string
  /** Also print the log: a rebuild runs in the foreground of the CI's SSH call. */
  echo?: boolean
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
        return this.run(plan.service.stop)
      case 'start':
        return this.run(plan.service.start)
      case 'fetch':
        return this.run(['git', 'fetch', '--tags'])
      case 'checkout':
        return this.run(this.checkout(plan.target!.tag))
      case 'restore':
        return this.run(this.checkout(plan.from.commit))
      case 'install':
        return this.run(npm(plan.install === 'install' ? 'install' : 'ci', '--no-audit', '--no-fund'))
      case 'build':
        return this.run(npm('run', 'build'))
      case 'answer':
        return this.answer(rollback ? plan.from.version : (plan.target?.version ?? null))
      case 'launch':
        return
    }
  }

  /** A branch the checkout was on moves with it, so a `git pull` by hand still works; a detached HEAD stays detached. */
  private checkout(to: string): string[] {
    const { branch } = this.plan.from
    return branch === null ? ['git', 'checkout', '--detach', to] : ['git', 'checkout', '-B', branch, to]
  }

  private run(argv: string[]): Promise<void> {
    const [command, ...args] = argv
    this.log(`$ ${argv.join(' ')}`)
    return new Promise((resolve, reject) => {
      let output = ''
      const child = spawn(command!, args, { cwd: this.plan.root, windowsHide: true, shell: process.platform === 'win32' && command === 'npm' })
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
        busy = busyChains(chain?.active ?? [])
      } catch {
        return
      }
      if (busy.length === 0) return
      this.log(`waiting for ${busy.join(', ')} to settle`)
      await sleep(SETTLE_POLL_MS)
    }
    this.log(`chains did not settle in ${this.plan.settleMs / 1000} s, going on`)
  }

  /** A later start that answers with `version` (any, for a rebuild), and still the same start `steadyMs` on. */
  private async answer(version: string | null): Promise<void> {
    const { plan } = this
    const deadline = Date.now() + plan.answerMs
    let last = 'no answer'
    while (Date.now() < deadline) {
      try {
        const state = await this.state()
        const current = (state.updates as { current?: unknown } | undefined)?.current
        const startedAt = state.startedAt
        if (startedAt === plan.startedAt) last = 'the service that ran before still answers'
        else if (version !== null && current !== version) last = `it answers with version ${String(current)}`
        else {
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

/** npm through the node running this process: the service's PATH may lack it; a shell only for the `npm.cmd` fallback. */
function npm(...args: string[]): string[] {
  const base = dirname(process.execPath)
  const cli = [join(base, 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(base, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].find((path) => existsSync(path))
  return cli === undefined ? ['npm', ...args] : [process.execPath, cli, ...args]
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
