import { englishOf, notice, noticeOf, type Notice } from '../notice/notice.js'
import type { LandOutcome } from '../git/landing.js'
import type { ForwardOutcome } from '../git/sync.js'
import type { TaskMoves } from '../machine/tasks.js'
import type { ActiveChain, ChainState, CurrentTask, DispatcherDeps, Landing } from './model.js'
import { LANDING_ROUNDS, landingPrompt } from './prompts.js'
import { warmSince } from './relay.js'

/** The waits after the first network failures of a landing, then `REMOTE_WAIT_MS` between tries while the remote stays away. */
const RETRY_MS = [30_000, 120_000]
const REMOTE_WAIT_MS = 600_000
/** How long a step waits for a landing: one that merges, checks or waits for a machine off the link goes on behind the chain. */
export const LANDING_WAIT_MS = 2_000

const FORWARD_LINES: Record<ForwardOutcome, string> = {
  forwarded: 'is at',
  offMain: 'is left, the checkout is off main, at',
  dirty: 'is left, the checkout has changes, at',
  merging: 'is left, a merge is under way, at',
  notFastForward: 'is left, it is ahead or diverged, at',
}

export interface LandingHost {
  /** Pauses the chain on its current task, which stays current: the chat answers its session, Skip acts on it. */
  hold(chain: ActiveChain, error: Notice): void
  /** A landing that went on behind the chain is over: a pass of the chain takes its outcome. */
  wake(): void
}

/** A landing under way, or over and not taken by a step yet. */
interface Flight {
  task: string
  /** The machine that lands it: the task's. */
  machine: string
  settled?: { outcome: LandOutcome } | { error: unknown }
}

export function landingOf(state: ChainState, project: string, task: string): Landing | undefined {
  return state.landings[project]?.find((landing) => landing.task === task)
}

/** The task is done, cleaned up after or left the chain: its landing is over. */
export function dropLanding(state: ChainState, project: string, task: string): boolean {
  const all = state.landings[project]
  if (all === undefined || !all.some((landing) => landing.task === task)) return false
  const kept = all.filter((landing) => landing.task !== task)
  if (kept.length === 0) delete state.landings[project]
  else state.landings[project] = kept
  return true
}

/** A person answered the task's session: its rounds start over (BTN-1581). */
export function answeredLanding(state: ChainState, project: string, task: string): void {
  const landing = landingOf(state, project, task)
  if (landing !== undefined) landing.rounds = 0
}

function recordOf(state: ChainState, project: string, task: string): Landing {
  const found = landingOf(state, project, task)
  if (found !== undefined) return found
  const made: Landing = { task, rounds: 0 }
  ;(state.landings[project] ??= []).push(made)
  return made
}

function clearNetwork(landing: Landing): void {
  delete landing.waitingRemote
  delete landing.failures
  delete landing.retryAt
}

/**
 * The landing of a task's merge into the main of the project's remotes (BTN-1581, `docs/chain/worktrees.md`, "Landing"):
 * once the task's session merged and ended its turn, the machine pushes main, merging in and checking what the remotes
 * got meanwhile. A conflict or a red check rolls main back and goes to the session, three rounds at most; a remote out of
 * reach is tried again with the task not closed and its session told nothing; a refusal pauses the chain.
 *
 * The turn (BTN-1583, `docs/machines.md`, "Landings across machines"): a project lands one task at a time on all its
 * machines, the others waiting until it landed or went back to its session, so a slow merge and check is not overtaken
 * again and again. A landing longer than `LANDING_WAIT_MS` goes on behind the chain, its step held; one whose machine went
 * off the link waits for it to come back and gives up the turn meanwhile. A landing that went through has the other
 * machines of the pool bring their main up to the pushed commit.
 */
export class Landings {
  /** By project: the landings under way, and those over whose outcome no step has taken yet. */
  private readonly flights = new Map<string, Flight[]>()
  /** By task: the task whose landing it waits for, told in the log once. */
  private readonly waits = new Map<string, string>()

  constructor(
    private readonly state: ChainState,
    private readonly deps: DispatcherDeps,
    private readonly handovers: TaskMoves,
    private readonly host: LandingHost,
    private readonly waitMs = LANDING_WAIT_MS,
  ) {}

  /**
   * The lane's current task on each step: `true` — the landing holds the task, the step goes no further with it: it is
   * under way or waits for its turn, a message went to the session or waits for it, a remote is waited for, or the chain
   * paused. `commit` — a carry's release commit, which stands for the branches.
   */
  async follow(chain: ActiveChain, current: CurrentTask, commit?: string): Promise<boolean> {
    const land = this.deps.machine.land
    const { project } = chain
    const { task } = current
    if (land === undefined || (this.deps.machine.busy(task) && !this.deps.machine.shell(task))) return false
    const record = landingOf(this.state, project, task)
    if (record?.message !== undefined) return this.deliver(chain, current, record)
    if (record?.retryAt !== undefined && Date.parse(record.retryAt) > this.deps.now().getTime()) return true
    const flown = this.flightOf(project, task)
    if (flown !== undefined) {
      if (flown.settled === undefined) return true
      this.take(project, flown)
      return this.settle(chain, current, flown.settled)
    }
    const machine = this.machineOf(project, task)
    // Nothing is asked of a machine off the link: the call would wait for it.
    if (!this.online(machine)) return false
    const turn = this.turnOf(project)
    if (turn !== undefined) {
      this.waitFor(task, turn)
      return true
    }
    this.waits.delete(task)
    const flight: Flight = { task, machine }
    this.flights.set(project, [...(this.flights.get(project) ?? []), flight])
    if (!(await this.quickly(flight, land(project, task, commit)))) {
      this.deps.log(`chain: ${task}: its landing goes on behind the chain, the other tasks of ${project} wait to land`)
      return true
    }
    this.take(project, flight)
    if (chain.current !== current) return true
    return this.settle(chain, current, flight.settled!)
  }

  private flightOf(project: string, task: string): Flight | undefined {
    return this.flights.get(project)?.find((flight) => flight.task === task)
  }

  /** The flight's outcome is taken: it leaves the project's flights. */
  private take(project: string, flight: Flight): void {
    const kept = (this.flights.get(project) ?? []).filter((each) => each !== flight)
    if (kept.length === 0) this.flights.delete(project)
    else this.flights.set(project, kept)
  }

  private machineOf(project: string, task: string): string {
    const machines = this.deps.machines
    return machines === undefined ? '' : (machines.holder(project, task) ?? machines.own())
  }

  private online(machine: string): boolean {
    return this.deps.machines?.online?.(machine) ?? true
  }

  /** The landing that holds the project's turn: under way on a machine on the link. */
  private turnOf(project: string): Flight | undefined {
    return this.flights.get(project)?.find((flight) => flight.settled === undefined && this.online(flight.machine))
  }

  private waitFor(task: string, turn: Flight): void {
    if (this.waits.get(task) === turn.task) return
    this.waits.set(task, turn.task)
    this.deps.log(`chain: ${task} waits to land until the landing of ${turn.task} is over`)
  }

  /** Whether the landing was over within the wait; else its end wakes the chain. */
  private async quickly(flight: Flight, landing: Promise<LandOutcome>): Promise<boolean> {
    const settled = landing.then(
      (outcome) => {
        flight.settled = { outcome }
      },
      (error: unknown) => {
        flight.settled = { error }
      },
    )
    let timer: ReturnType<typeof setTimeout> | undefined
    const quick = await Promise.race([settled.then(() => true), new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), this.waitMs)))])
    clearTimeout(timer)
    if (!quick) void settled.then(() => this.host.wake())
    return quick
  }

  private settle(chain: ActiveChain, current: CurrentTask, settled: NonNullable<Flight['settled']>): Promise<boolean> | boolean {
    if ('outcome' in settled) return this.apply(chain, current, settled.outcome)
    this.deps.log(`chain: ${current.task}: the landing could not run: ${englishOf(noticeOf(settled.error))}`)
    return false
  }

  /**
   * Main of the project's remotes is at `commit` now: each other machine of its pool on the link brings its main up to it
   * by fast-forward, so its sessions merge into a fresh main (BTN-1583). Nobody waits for it; each end is a line in the log.
   */
  private spread(project: string, task: string, commit: string | undefined): void {
    const { machines, machine } = this.deps
    if (machines === undefined || machine.forward === undefined || commit === undefined) return
    const from = this.machineOf(project, task)
    for (const { id } of machines.list()) {
      if (id === from || !machines.serves(project, id) || !this.online(id)) continue
      machine.forward(project, commit, id).then(
        (outcome) => this.deps.log(`chain: ${project}: machine ${id} after the landing of ${task}: main ${FORWARD_LINES[outcome]} ${commit.slice(0, 7)}`),
        (error: unknown) => this.deps.log(`chain: ${project}: machine ${id} did not bring main up to ${commit.slice(0, 7)}: ${englishOf(noticeOf(error))}`),
      )
    }
  }

  private async apply(chain: ActiveChain, current: CurrentTask, outcome: LandOutcome): Promise<boolean> {
    const { project } = chain
    const { task } = current
    const main = this.deps.mainBranch(task)
    if (outcome.state === 'none') {
      const record = landingOf(this.state, project, task)
      if (record?.failures !== undefined) {
        clearNetwork(record)
        this.deps.save(this.state)
      }
      return false
    }
    if (outcome.state === 'landed') {
      this.deps.log(`chain: ${task} landed in ${main} of the remote`)
      dropLanding(this.state, project, task)
      this.deps.save(this.state)
      this.spread(project, task, outcome.commit)
      void this.deps.refresh(project).catch(() => undefined)
      return false
    }
    if (outcome.state === 'failed') {
      const record = recordOf(this.state, project, task)
      if (outcome.network) {
        const failures = (record.failures ?? 0) + 1
        const wait = RETRY_MS[failures - 1] ?? REMOTE_WAIT_MS
        record.failures = failures
        record.retryAt = new Date(this.deps.now().getTime() + wait).toISOString()
        if (failures > RETRY_MS.length) record.waitingRemote = true
        this.deps.log(`chain: ${task}: the remote is out of reach for its landing, tried again in ${wait / 1000} s: ${englishOf(outcome.failure)}`)
        this.deps.save(this.state)
        return true
      }
      clearNetwork(record)
      this.host.hold(chain, notice('landing.refused', { task, main }, { cause: outcome.failure }))
      return true
    }
    const record = recordOf(this.state, project, task)
    clearNetwork(record)
    record.resolving = true
    if (record.rounds >= LANDING_ROUNDS) {
      this.deps.save(this.state)
      this.host.hold(chain, notice('landing.exhausted', { task, main, rounds: record.rounds }))
      return true
    }
    record.rounds += 1
    const facts = 'files' in outcome
      ? { remote: outcome.remote, main, round: record.rounds, files: outcome.files }
      : { remote: outcome.remote, main, round: record.rounds, ...outcome.red }
    record.message = landingPrompt(facts, this.deps.promptLanguage(task))
    this.deps.save(this.state)
    return this.deliver(chain, current, record)
  }

  /**
   * Invariant 1, exception 13: the message resumes the session while its cache is warm, else a new session takes the
   * task with it, as feedback on a pull request does. It waits while the account's limit or a launch block holds.
   */
  private async deliver(chain: ActiveChain, current: CurrentTask, record: Landing): Promise<boolean> {
    const { project } = chain
    const { task } = current
    if (this.deps.blocked(project, task) !== undefined || this.deps.machine.limitReset(project, task) !== null) return true
    const session = this.deps.machine.handoff(task)
    if (session === undefined || session.sessionId !== current.sessionId) return false
    const message = record.message!
    const account = this.deps.machine.account(project, task)
    const now = this.deps.now()
    const warm =
      account.id !== null &&
      session.lastReplyAt !== null &&
      account.id === this.deps.machine.accountAt(session.account, session.lastReplyAt) &&
      warmSince(session, now.getTime())
    const at = now.toISOString()
    current.starting = at
    try {
      const sessionId = warm ? await this.deps.machine.reply(task, session, message) : await this.handovers.handOver(project, task, session, 'landing', message)
      this.deps.journal({ at, project, task, sessionId, reason: warm ? 'resume' : 'relay', cause: 'landing', previous: session.sessionId })
      this.deps.log(`chain: ${task}: its landing went back to its session (round ${record.rounds} of ${LANDING_ROUNDS}), ${warm ? 'resumed' : 'handed over'}`)
      delete record.message
      current.sessionId = sessionId
      current.resumedAt = at
    } catch (error) {
      this.host.hold(chain, noticeOf(error))
    } finally {
      delete current.starting
      this.deps.save(this.state)
    }
    return true
  }
}
