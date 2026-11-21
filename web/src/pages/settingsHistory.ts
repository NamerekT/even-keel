import type { Draft, Value, Values } from './settingsDraft.js'

/** One edit of a draft as Ctrl+Z steps it back (BTN-1064): the fields it changed, with their values before and after. */
export interface Step {
  /** When the step was last made or moved, across every draft: a form over two drafts steps the latest of both. */
  seq: number
  before: Values
  after: Values
}

/** The steps of a draft not saved yet: `back` for Ctrl+Z, `forward` for Ctrl+Shift+Z, the latest last in each. */
export interface History {
  back: readonly Step[]
  forward: readonly Step[]
}

export const EMPTY_HISTORY: History = { back: [], forward: [] }

const equal = (a: Value | undefined, b: Value | undefined) => JSON.stringify(a) === JSON.stringify(b)
const sameKeys = (a: Values, b: Values) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => key in b)

/** Whether the values a draft started from differ between two of its states. */
export function baseMoved(before: Draft, next: Draft): boolean {
  const keys = new Set([...Object.keys(before.base), ...Object.keys(next.base)])
  return [...keys].some((key) => !equal(before.base[key], next.base[key]))
}

/**
 * The history once the draft went from `before` to `next`. A base changed — a save, the file changed under the draft —
 * starts it over; an edit of the same fields as the last step joins that step, and one that comes back to where the
 * step started removes it; any new edit drops what was undone.
 */
export function historyAfter(history: History, before: Draft, next: Draft, seq: number): History {
  if (baseMoved(before, next)) return EMPTY_HISTORY
  const touched = [...new Set([...Object.keys(before.edit), ...Object.keys(next.edit)])].filter((key) => !equal(before.edit[key], next.edit[key]))
  if (touched.length === 0) return history
  const after = Object.fromEntries(touched.map((key) => [key, next.edit[key]!]))
  const last = history.back.at(-1)
  if (last === undefined || !sameKeys(last.after, after)) return { back: [...history.back, { seq, before: Object.fromEntries(touched.map((key) => [key, before.edit[key]!])), after }], forward: [] }
  const rest = history.back.slice(0, -1)
  const back = touched.every((key) => equal(last.before[key], after[key])) ? rest : [...rest, { seq, before: last.before, after }]
  return { back, forward: [] }
}

/** Whether a step touches the open section: `null` — the whole draft is one. */
const within = (step: Step, keys: readonly string[] | null) => keys === null || Object.keys(step.after).some((key) => keys.includes(key))

/**
 * The latest step of the open section to step back, and the history with it moved forward under `seq`: across drafts
 * the step undone last is the one made again first.
 */
export function undone(history: History, keys: readonly string[] | null, seq: number): [Step, History] | null {
  const at = history.back.findLastIndex((step) => within(step, keys))
  if (at < 0) return null
  const step = history.back[at]!
  return [step, { back: history.back.toSpliced(at, 1), forward: [...history.forward, { ...step, seq }] }]
}

/** The step of the open section undone last, to make again, and the history with it moved back under `seq`; `null` — none. */
export function redone(history: History, keys: readonly string[] | null, seq: number): [Step, History] | null {
  const at = history.forward.findLastIndex((step) => within(step, keys))
  if (at < 0) return null
  const step = history.forward[at]!
  return [step, { back: [...history.back, { ...step, seq }], forward: history.forward.toSpliced(at, 1) }]
}
