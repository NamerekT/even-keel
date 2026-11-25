import type { NoteText } from '../chain/handoff-note.js'
import type { CurrentTask } from '../chain/model.js'
import type { Language } from '../language.js'
import type { Notice } from '../notice/notice.js'
import type { LaunchBrief, MachinePort } from './port.js'

/** The moves of a task's session the machine makes (`docs/machines/seam.md`, "Moves"), as the link names them: `task.<move>`. */
export const MOVES = ['follow', 'guard', 'deliver', 'deliverLoose', 'replace', 'renew', 'handOverCurrent', 'handOver'] as const
export type MoveName = (typeof MOVES)[number]
export const MOVE_PREFIX = 'task.'
/** The machine's event: the state of a move's task, kept before the move touches its session. */
export const MOVE_STATE_EVENT = 'task.state'

export const isMove = (name: string): name is MoveName => (MOVES as readonly string[]).includes(name)

/** The fields of the current task a move changes; the hub keeps the rest of it. */
const MOVE_FIELDS = ['sessionId', 'resumedAt', 'limit', 'starting', 'move', 'answering', 'reply', 'ask', 'message'] as const
export type MoveFields = Pick<CurrentTask, (typeof MOVE_FIELDS)[number]>

export function fieldsOf(current: CurrentTask): MoveFields {
  const fields: Partial<Record<(typeof MOVE_FIELDS)[number], unknown>> = {}
  for (const key of MOVE_FIELDS) if (current[key] !== undefined) fields[key] = current[key]
  return fields as MoveFields
}

/** Puts a move's fields into the hub's task: a field the move removed is removed. */
export function applyFields(current: CurrentTask, fields: MoveFields): void {
  const target = current as unknown as Record<string, unknown>
  for (const key of MOVE_FIELDS) {
    if (fields[key] === undefined) delete target[key]
    else target[key] = fields[key]
  }
}

/** What the hub decides about the move's task and sends with it: the machine does not know the hub's settings. */
export interface MoveContext {
  /** Why a session of the task may not start now (`DispatcherDeps.blocked`). */
  blocked: Notice | null
  language: Language
  mainBranch: string
  pullRequests: boolean
  plain: boolean
  /** The report of the red main or the carry, for a fix or carry session's handoff. */
  report: string | null
  /** A fresh hub brief for a possible handoff, including after a machine restart. */
  brief?: LaunchBrief
  /** The task's newest handoff note the hub keeps, for a possible handoff (BTN-1046); absent — none. */
  note?: NoteText
}

export interface MoveCall {
  project: string
  /** The task the move is about, by name: what the hub prepares its brief for and routes it by. */
  task: string
  /** The task the move is about as the hub holds it; absent for a move without one (`deliverLoose`, `handOver`). */
  current?: CurrentTask
  /** `current` is still the current task of the project's chain. */
  isCurrent: boolean
  /** The project's chain is active. */
  active: boolean
  context: MoveContext
  /** The move's own arguments after the chain and the task. */
  args: unknown[]
}

export interface MoveDone {
  value?: unknown
  /** The move's fields of its task after it. */
  current?: MoveFields
  /** The chain pauses on this notice; `keep` — its current task stays current. */
  halt?: { notice: Notice; keep: boolean }
}

export interface MoveSaved {
  project: string
  task: string
  fields: MoveFields
  /** The end of a move the machine made without the hub (BTN-1226): the fields after it. */
  alone?: true
  /** That move paused the chain. */
  halt?: MoveDone['halt']
}

/** What the hub's port carries the moves through; a port without it has the hub make them in its own process. */
export interface MovesPort {
  run: (name: MoveName, call: MoveCall) => Promise<MoveDone>
  /** `take` gets the state of a move's task the machine kept mid-move, as the hub would get its own `save`. */
  onSaved: (take: (saved: MoveSaved) => void) => void
}

type DueReads = Pick<MachinePort, 'limited' | 'handoff' | 'modelRefusal' | 'overage'>

/**
 * Whether a follow has anything to do: a refusal of the model, a move under way, a limit held or hit, a checkpoint.
 * Otherwise `Handovers.follow` changes nothing, so the hub spares a command and the machine alone a move.
 */
export function followDue(machine: DueReads, current: CurrentTask): boolean {
  if (current.starting !== undefined || current.limit !== undefined) return true
  if (current.sessionId !== null && machine.modelRefusal?.(current.task, current.sessionId) !== undefined) return true
  return machine.limited(current.task) !== undefined || (machine.handoff(current.task)?.checkpoint ?? null) !== null
}

/** Whether the paid-usage stop has anything to stop: a hold or evidence of paid usage of the session. */
export function guardDue(machine: DueReads, current: CurrentTask | null): boolean {
  if (current?.sessionId == null || current.starting !== undefined) return false
  return current.limit?.overage !== undefined || machine.overage?.(current.task) !== undefined
}
