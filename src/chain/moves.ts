import { fail, notice, NoticeError, type Notice } from '../notice/notice.js'
import type { TaskStatus } from '../tracker/model.js'
import { isActive, isDone, sameName, type ChainRules } from './rules.js'

/**
 * The statuses Even Keel moves a task into by itself (BTN-554): when it starts the task, when it opens the task's pull
 * request and when it closes the task after its branch is merged. Kept by a tracker profile and, over it, by a source of
 * a project's tasks (its main tracker, a feed).
 */
export interface StatusMoves {
  /** No key — not set; `null` — leave the status as it is. */
  start?: string | null
  review?: string | null
  /** No key — the tracker's first done status, as before the setting. */
  done?: string
}

export const MOVE_SETTINGS = ['start', 'review', 'done'] as const
export type MoveSetting = (typeof MOVE_SETTINGS)[number]
export type MoveWhen = Exclude<MoveSetting, 'done'>

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The status moves of a config entry, names trimmed and blanks dropped as not set; throws `config.statusMoves`. */
export function statusMovesOf(raw: unknown, where: string): StatusMoves {
  const invalid = () => fail('config.statusMoves', { where })
  if (!isRecord(raw)) throw invalid()
  const moves: StatusMoves = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!(MOVE_SETTINGS as readonly string[]).includes(key)) throw invalid()
    if (value === null && key !== 'done') moves[key as MoveWhen] = null
    else if (typeof value !== 'string') throw invalid()
    else if (value.trim() !== '') moves[key as MoveSetting] = value.trim()
  }
  return moves
}

/** What a source runs on: `null` of `start`/`review` — leave the status; of `done` — automatic. */
export interface Moves {
  start: string | null
  review: string | null
  done: string | null
}

const own = (moves: StatusMoves | undefined, key: MoveSetting): boolean => moves !== undefined && Object.hasOwn(moves, key) && moves[key] !== undefined

/** The source's own values over the profile's, key by key; none on either — leave the status, close automatically. */
export function movesOf(profile: StatusMoves | undefined, source: StatusMoves | undefined): Moves {
  const pick = (key: MoveSetting): string | null => (own(source, key) ? source![key]! : own(profile, key) ? profile![key]! : null)
  return { start: pick('start'), review: pick('review'), done: pick('done') }
}

/** Where the value a source runs on is set: `null` — nowhere, it is the default. */
export function moveLevel(profile: StatusMoves | undefined, source: StatusMoves | undefined, key: MoveSetting): 'source' | 'profile' | null {
  return own(source, key) ? 'source' : own(profile, key) ? 'profile' : null
}

/**
 * Whether to move a task now in `current` to `target`, only forward: on its start only a ready task, on its pull request
 * any open one, never one already there. `outside` — the target is out of the chain by the rules, which would release the
 * task at once. `target` is `null` when the tracker did not list the status: the move is tried and the tracker answers.
 */
export function moveVerdict(when: MoveWhen, rules: ChainRules, current: TaskStatus, target: TaskStatus | null): 'move' | 'stay' | 'outside' {
  const name = target?.name
  if (name !== undefined && sameName(current.name, name)) return 'stay'
  if (when === 'start' && current.category !== 'ToDo') return 'stay'
  if (when === 'review' && (current.category === 'Won' || current.category === 'Lost')) return 'stay'
  return target === null || isActive(rules, target) ? 'move' : 'outside'
}

/**
 * Whether the rules may take a status of this name for done, its category aside: a list of terminal statuses must name it.
 * The tracker's `complete` takes only a status of the `Won` category, so the two together are `isDone`.
 */
export const doneNamed = (rules: ChainRules, name: string): boolean => rules.terminal === null || rules.terminal.some((each) => sameName(each, name))

/**
 * The first choice the rules do not allow, by the statuses the tracker lists: a start or review status out of the chain,
 * a done status the chain does not take for done. A status the tracker did not list is judged by its name only.
 */
export function movesProblem(rules: ChainRules, moves: StatusMoves, statuses: readonly TaskStatus[]): Notice | null {
  const known = (name: string) => statuses.find((status) => sameName(status.name, name))
  for (const setting of ['start', 'review'] as const) {
    const name = moves[setting]
    if (typeof name !== 'string') continue
    const status = known(name)
    if (status !== undefined && !isActive(rules, status)) return notice('statusMoves.outside', { status: name, setting })
  }
  const done = moves.done
  if (done === undefined) return null
  const status = known(done)
  const fits = status === undefined ? doneNamed(rules, done) : isDone(rules, status)
  return fits ? null : notice('statusMoves.notDone', { status: done })
}

/** `movesProblem` as a refused save. */
export function checkMoves(rules: ChainRules, moves: StatusMoves, statuses: readonly TaskStatus[]): void {
  const problem = movesProblem(rules, moves, statuses)
  if (problem !== null) throw new NoticeError(problem)
}

const REVIEW_NAME = /review|ревью/i

/**
 * The values offered right after a profile is added: the first started status in the chain, the started one named for
 * review; nothing fits — leave the status. The close stays automatic.
 */
export function defaultMoves(rules: ChainRules, statuses: readonly TaskStatus[]): { start: string | null; review: string | null } {
  const started = statuses.filter((status) => status.category === 'Active' && isActive(rules, status))
  return { start: started[0]?.name ?? null, review: started.find((status) => REVIEW_NAME.test(status.name))?.name ?? null }
}

/** The done status a source closes its tasks into, where it is set, and whether the rules take it for done. */
export interface DoneMove {
  status: string
  level: 'source' | 'profile'
  fits: boolean
}

/** `undefined` — the close is automatic: the tracker's first done status. */
export function doneMove(rules: ChainRules, profile: StatusMoves | undefined, source: StatusMoves | undefined): DoneMove | undefined {
  const status = movesOf(profile, source).done
  const level = moveLevel(profile, source, 'done')
  return status === null || level === null ? undefined : { status, level, fits: doneNamed(rules, status) }
}
