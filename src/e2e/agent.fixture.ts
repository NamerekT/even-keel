import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AccountHome } from '../account/homes.js'
import type { AccountStatus } from '../account/model.js'
import type { ModelList, SessionHandle } from '../agent/contract.js'
import { Gate, SCRIPT_PID, ScriptedAgent as ScriptCore, type Turn, type TurnEnd } from '../agent/scripted.js'
import { runGit } from '../git/run.js'
import type { RateLimits } from '../limits/model.js'
import type { UsageAnswer } from '../limits/usage.js'
import { notice } from '../notice/notice.js'
import type { AgentEntry } from '../sessions/agents.js'

export { Gate, type Call, type Turn, type TurnContext, type TurnEnd } from '../agent/scripted.js'

/** The windows a `usage` answer gives; its time and source are the call's. */
export type LimitWindows = Pick<RateLimits, 'fiveHour' | 'sevenDay'> & Partial<Pick<RateLimits, 'month'>>

/**
 * The product's scripted agent (`src/agent/scripted.ts`) with the bench's levers: a held listing, refused stops, model
 * lists, `usage` windows and sign-in statuses a scenario sets.
 */
export class ScriptedAgent extends ScriptCore {
  /** Holds every listing of the sessions until it opens, as a long first read of the monitor after a restart does. */
  listing: Gate | null = null
  /** How many stops to come the CLI refuses, the session left as it was: a resume, which stops first, fails with it. */
  refuse = 0
  /** The models every account lists, the list complete; `null` — the agent has no list, as Claude's. */
  modelList: string[] | null = null
  /**
   * The account's windows at the bench's time `at`, as `usage` answers them (`source: 'usage'`); `missing` — the
   * provider tells of no windows at all, as Copilot or OpenCode Zen; `null` — an answer without readable limits. Unset,
   * the agent has no `usage`, and the chain waits a limit out by the transcript.
   */
  windows: ((account: string, at: string) => LimitWindows | 'missing' | null) | null = null
  /** Holds every `usage` call until it opens, as a slow `/usage` does; the call keeps the time it was asked at. */
  usageGate: Gate | null = null
  /** Each `usage` call: the account and the time it was asked at. */
  readonly polls: { account: string; at: string }[] = []
  /**
   * What an account's sign-in shows over the default — a subscription as `<key>@example.com`: `authMethod: 'api_key'`
   * for a key, `email: null` for a folder with no e-mail.
   */
  readonly statuses = new Map<string, Partial<AccountStatus>>()

  /** The listing gives a resting session as `waiting` with no question of its own, as the CLI did in the BTN-245 case. */
  waits(sessionId: string): void {
    const session = this.known.get(sessionId)!
    session.entry = { ...session.entry, pid: SCRIPT_PID, status: 'waiting', state: 'blocked' }
  }

  /** A session ended or stopped: its process left, so the service sees it finished. */
  isGone(sessionId: string): boolean {
    const entry = this.known.get(sessionId)?.entry
    return entry === undefined || (entry.pid === undefined && entry.resting !== true)
  }

  /** Set by `modelList`: an agent without a list leaves the method out. */
  get models(): ((home: AccountHome) => Promise<ModelList>) | undefined {
    const models = this.modelList
    return models === null ? undefined : async () => ({ models: [...models], complete: true })
  }

  /** Set by `windows`: an agent without a source of limits leaves the method out. */
  get usage(): ((home: AccountHome, at: string) => Promise<UsageAnswer>) | undefined {
    const windows = this.windows
    if (windows === null) return undefined
    return async (home, at) => {
      this.polls.push({ account: home.key, at })
      await this.usageGate?.passed
      const told = windows(home.key, at)
      if (told === null) return { kind: 'unknown', reason: notice('usage.noSession', {}) }
      if (told === 'missing') return { kind: 'missing', reason: notice('usage.noLimits', {}) }
      return { kind: 'limits', limits: { ...told, updatedAt: at, source: 'usage' } }
    }
  }

  override async stop(home: AccountHome, session: SessionHandle): Promise<void> {
    if (this.known.has(session.sessionId) && this.refuse > 0) {
      this.refuse--
      throw new Error('script: the CLI refused the stop')
    }
    return super.stop(home, session)
  }

  override async sessions(home: AccountHome): Promise<AgentEntry[]> {
    await this.listing?.passed
    return super.sessions(home)
  }

  override async authStatus(home: AccountHome): Promise<AccountStatus> {
    return { ...(await super.authStatus(home)), ...this.statuses.get(home.key) }
  }
}

/** A turn that writes a file, commits it on the task's branch and merges the branch into the main checkout. */
export function commitAndMerge(file = 'work.txt'): Turn {
  return async ({ task, cwd, repo, git }) => {
    await writeFile(join(cwd, file), `${task}\n`)
    await git('add', file)
    await git('commit', '-m', `[${task}] Work`)
    const branch = await git('rev-parse', '--abbrev-ref', 'HEAD')
    const merged = await runGit(repo, ['merge', '--no-edit', branch])
    if (merged.code !== 0) throw new Error(`script: merge of ${branch}: ${merged.out}`)
    return { say: `${task} merged` }
  }
}

/** A turn that works until `gate` opens, then goes on as `then`. */
export function parked(gate: Gate, then: Turn): Turn {
  return async (turn) => {
    await turn.park(gate)
    return then(turn)
  }
}

/** A turn that goes as `first`, then works on until `gate` opens and ends as `first` did: a check after the merge. */
export function lingers(first: Turn, gate: Gate): Turn {
  return async (turn) => {
    const end = await first(turn)
    await turn.park(gate)
    return end
  }
}

/** A turn that writes its handoff note into the task's folder and ends with `CHECKPOINT:` naming it. */
export function checkpoint(note: string, text: string): Turn {
  return async ({ cwd }) => {
    await mkdir(dirname(join(cwd, note)), { recursive: true })
    await writeFile(join(cwd, note), text)
    return { checkpoint: note }
  }
}

/** Where PR mode's prompt has a session describe its pull request. */
export const PULL_NOTE = '.temp/pull-request.md'

/**
 * A turn of PR mode: writes `file` (none — the task changes nothing), commits it on the task's branch as `[<task>]
 * <subject>`, describes the pull request in `PULL_NOTE` and ends with its mark.
 */
export function forReview(file: string | null = 'work.txt', text?: string, subject = 'Work'): Turn {
  return async ({ task, cwd, git }) => {
    if (file !== null) {
      await mkdir(dirname(join(cwd, file)), { recursive: true })
      await writeFile(join(cwd, file), text ?? `${task}\n`)
      await git('add', file)
      await git('commit', '-m', `[${task}] ${subject}`)
    }
    await mkdir(join(cwd, '.temp'), { recursive: true })
    await writeFile(join(cwd, PULL_NOTE), `[${task}] Work\n\nWhat the task did.\n`)
    return { pullRequest: PULL_NOTE }
  }
}

/** A turn that ends the way `end` says. */
export function ends(end: TurnEnd): Turn {
  return async () => end
}
