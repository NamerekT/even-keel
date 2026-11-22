import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isAncestor, readCheckout } from './checkout.js'
import type { ServiceControl } from './control.js'
import { recordOf, type UpdateRecord, type UpdateStep, type UpdateTarget } from './model.js'
import { busyChains } from './settle.js'
import { CheckoutMoved, runSteps, StepError, type StepPlan } from './steps.js'

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

/** How many more builds a rebuild runs after a chain moved its checkout on along the branch (BTN-1426). */
export const CATCH_UP_BUILDS = 3
/**
 * How long a planned stop keeps the sessions' facts away, the restart and the read after it: keep-warm pings ahead
 * of the stop every cache that would go cold within it (BTN-1527). Measured 20.11–22.11.2026: a stop with an install
 * and a build under it 97–112 s down, and the facts 30–52 s after `listening`.
 */
export const WARM_AHEAD_MS = 4 * 60_000
/** A keep-warm ping takes 3 minutes at most. */
const WARM_WAIT_MS = 200_000

class Runner {
  private readonly began = Date.now()
  /** The commit a rebuild builds: a chain merging into the checkout meanwhile moves it on. */
  target: UpdateTarget | null
  /** The commit a rebuild's rollback went on to instead of the one before, the checkout having moved on. */
  onward: UpdateTarget | null = null
  private built = false
  private stopped = false

  constructor(private readonly plan: UpdatePlan) {
    this.target = plan.target
  }

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
        if (plan.mode === 'rebuild' && !rollback) return this.stopRebuild()
        // A service that came up meanwhile may be launching a chain's next task, which a stop would cut (BTN-1479).
        if (rollback) await this.settle()
        return this.stopService()
      case 'start':
        return this.run(plan.service.start)
      case 'fetch':
        // The hub's commit may be on any remote of the machine's checkout.
        return this.run(plan.mode === 'follow' ? ['git', 'fetch', '--all', '--tags'] : ['git', 'fetch', '--tags'])
      case 'checkout':
        // Following the hub leaves the branch where it was: its commits stay, and a rollback puts HEAD back on it.
        return this.run(plan.mode === 'follow' ? ['git', 'checkout', '--detach', plan.target!.tag] : this.checkout(plan.target!.tag))
      case 'restore':
        if (plan.mode === 'rebuild') return this.restoreRebuild()
        return this.run(plan.package === undefined ? this.checkout(plan.from.commit) : this.installPackage(plan.from.version))
      case 'install':
        if (plan.package !== undefined) return this.run(this.installPackage(plan.target!.version))
        if (rollback && plan.mode === 'rebuild') return this.run(npm('ci', '--no-audit', '--no-fund'))
        if (plan.install === null && !dependenciesChanged(plan.root)) return this.log('package-lock.json did not change, nothing to install')
        return this.run(npm(plan.install === 'install' ? 'install' : 'ci', '--no-audit', '--no-fund'))
      case 'build':
        await this.run(this.buildCommand())
        if (plan.mode === 'rebuild' && (rollback ? this.onward !== null : this.stopped)) await this.catchUp(rollback)
        if (!rollback) this.built = true
        return
      case 'answer':
        if (plan.machine !== undefined) return this.contact(plan.machine.contact, rollback)
        return this.answer(rollback)
      case 'launch':
        return
    }
  }

  private buildCommand(): string[] {
    return npm('run', this.plan.machine === undefined ? 'build' : 'build:machine')
  }

  /**
   * The checkout against the commit aimed at: still on it, moved on along its branch by a chain's merge (the commit and
   * its version to aim at now), or `away` — off the branch, rewound, edited, or no checkout to read.
   */
  private async drift(): Promise<'same' | 'away' | UpdateTarget> {
    const { root, from } = this.plan
    const aim = this.onward ?? this.target
    const checkout = await readCheckout(root)
    if (aim === null || checkout === null || checkout.dirty || checkout.branch !== from.branch) return 'away'
    if (checkout.commit === aim.tag) return 'same'
    if (checkout.branch === null || !(await isAncestor(root, aim.tag, checkout.commit))) return 'away'
    try {
      const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown }
      return typeof version === 'string' ? { version, tag: checkout.commit } : 'away'
    } catch {
      return 'away'
    }
  }

  private aimAt(next: UpdateTarget, rollback: boolean, what: string): void {
    const aim = this.onward ?? this.target
    this.log(`the checkout moved on from ${aim?.tag} to ${next.tag} (${next.version}) during the rebuild, ${what}`)
    if (rollback) this.onward = next
    else this.target = next
  }

  /**
   * The wait for chains can outlast the green commit this run was called for: a merge since is built, anything else
   * stops it. With nothing to install the merge is built before the stop, the service still up: a build with it down
   * kept it down 74–173 s, past the five-minute cache's keep-warm margin (BTN-1527).
   */
  private async stopRebuild(): Promise<void> {
    let drift = await this.drift()
    if (drift === 'away') throw new CheckoutMoved('The checkout changed during the rebuild')
    for (let builds = 0; this.built && drift !== 'same' && builds < CATCH_UP_BUILDS && !dependenciesChanged(this.plan.root); builds++) {
      this.aimAt(drift, false, 'building it before the stop')
      await this.run(this.buildCommand())
      await this.settle()
      drift = await this.drift()
      if (drift === 'away') throw new CheckoutMoved('The checkout changed during the rebuild')
    }
    await this.stopService()
    this.stopped = true
    if (drift === 'same') return
    if (this.built) return this.catchUp(false)
    this.aimAt(drift, false, 'building it')
  }

  /** The service's keep-warm pings ahead of the stop, then the stop; a machine has no page to ask. */
  private async stopService(): Promise<void> {
    if (this.plan.machine === undefined) await this.warmAhead()
    return this.run(this.plan.service.stop)
  }

  /** A service that cannot be asked, an older one too, is stopped all the same: its caches may go cold under the stop. */
  private async warmAhead(): Promise<void> {
    try {
      const response = await fetch(new URL('/api/updates/warm', this.plan.state), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ms: WARM_AHEAD_MS }),
        signal: AbortSignal.timeout(WARM_WAIT_MS),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      this.log(`keep-warm pinged the caches that would go cold within ${WARM_AHEAD_MS / 1000} s`)
    } catch (error) {
      this.log(`keep-warm did not ping ahead of the stop: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * After a build with the service down: while a chain's merges move the checkout on, install what changed and build
   * again, `CATCH_UP_BUILDS` times at most. A checkout gone elsewhere is left to the answer, which then fails on the
   * commit, and to the rollback, which leaves it too.
   */
  private async catchUp(rollback: boolean): Promise<void> {
    for (let builds = 0; ; builds++) {
      const drift = await this.drift()
      if (drift === 'same') return
      if (drift === 'away') return this.log('the checkout changed during the rebuild and is left as it is')
      if (builds === CATCH_UP_BUILDS) throw new StepError(`The checkout kept moving during the rebuild: ${CATCH_UP_BUILDS} more builds did not catch up with ${drift.tag}`)
      this.aimAt(drift, rollback, 'building again')
      if (dependenciesChanged(this.plan.root)) await this.run(npm(rollback ? 'ci' : (this.plan.install ?? 'install'), '--no-audit', '--no-fund'))
      await this.run(this.buildCommand())
    }
  }

  /**
   * The rollback never resets the branch under a chain's merge: a checkout moved on along it is built where it is
   * instead of the commit before, a checkout gone elsewhere is left for inspection.
   */
  private async restoreRebuild(): Promise<void> {
    const drift = await this.drift()
    if (drift === 'away') throw new CheckoutMoved('The checkout changed during the rebuild, so the commit before is not restored')
    if (drift === 'same') return this.run(this.checkout(this.plan.from.commit))
    this.aimAt(drift, true, 'building it instead of the commit before')
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

  /**
   * The service came up on the checkout's HEAD after a chain's merge between the stop and the start moved it on along
   * the branch: it will never answer with the commit aimed at.
   */
  private async mergedSince(hubCommit: unknown): Promise<boolean> {
    if (typeof hubCommit !== 'string') return false
    const drift = await this.drift()
    return drift !== 'same' && drift !== 'away' && drift.tag === hubCommit
  }

  /**
   * A later start of the expected version and, for a rebuild, commit, still answering after steadyMs. A rollback
   * expects the version before, or the commit it went on to. A rebuild's service up on a commit merged since gives up
   * at once: the rollback stops it once the chains settle and builds that commit instead.
   */
  private async answer(rollback: boolean): Promise<void> {
    const { plan } = this
    const to = rollback ? this.onward : this.target
    const back = rollback && to === null
    const version = back ? plan.from.version : (to?.version ?? null)
    const commit = plan.mode === 'rebuild' ? (back ? plan.from.commit : to?.tag) : undefined
    const deadline = Date.now() + plan.answerMs
    let last = 'no answer'
    let moved: string | null = null
    while (Date.now() < deadline) {
      try {
        const state = await this.state()
        const current = (state.updates as { current?: unknown } | undefined)?.current
        const startedAt = state.startedAt
        if (typeof startedAt !== 'string' || startedAt === plan.startedAt) last = 'no new service start yet'
        else if (!rollback && commit !== undefined && state.hubCommit !== commit && (await this.mergedSince(state.hubCommit))) {
          moved = `the service started on ${String(state.hubCommit)}, which a chain merged into the checkout after ${commit}: the rollback builds it`
          break
        } else if (version !== null && current !== version) last = `it answers with version ${String(current)}`
        else if (commit !== undefined && state.hubCommit !== commit && !(back && plan.legacyRollback && state.hubCommit === undefined)) {
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
    if (moved !== null) throw new StepError(moved)
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
  if (outcome.rollback !== null && runner.onward !== null) outcome.rollback.to = runner.onward
  const record: UpdateRecord = { mode: plan.mode, from: plan.from, to: runner.target, startedAt, finishedAt: new Date().toISOString(), ...outcome, seen: false }
  writeRecord(plan.result, record)
  if (outcome.failed === null) runner.log(`${plan.mode} done${runner.target === null ? '' : ` at ${runner.target.tag}`}`)
  else {
    const { rollback } = outcome
    const back =
      rollback === null
        ? 'nothing to roll back'
        : rollback.failed === null
          ? rollback.to === undefined
            ? 'rolled back'
            : `went on to ${rollback.to.tag} instead`
          : rollback.failed.moved === true
            ? 'the checkout moved, nothing was rolled back'
            : `the rollback failed at ${rollback.failed.step}`
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
