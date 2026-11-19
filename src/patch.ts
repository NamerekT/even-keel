/**
 * The parts of an event's data sent by their entries, each with the field that names an entry: a live session changes
 * one session of hundreds, not the list (BTN-695). `OWN_KEYS` instead of a field — a dictionary sent by its keys.
 */
export type KeyedParts = Record<string, string>

/** A part that is a dictionary, sent by its keys: one project's CI changes, not the CI of all of them (BTN-1326). */
export const OWN_KEYS = ''

/**
 * What changed in the data of an event sent in parts (`EventHub`) since its last frame, sent as `<event>Patch`; the page
 * applies it with `applyPatch`. A part absent from all of them is as it was.
 */
export interface Patch {
  /** The parts that changed, whole; a keyed part whose entries do not name themselves apart is here too. */
  parts?: Record<string, unknown>
  gone?: string[]
  /** The changed entries of each keyed part, and its order of ids when that changed. */
  keyed?: Record<string, { by: string; order?: string[]; changed: unknown[] }>
  /** The changed values of each part keyed by `OWN_KEYS`, and its order of keys when that changed. */
  byKey?: Record<string, { order?: string[]; changed: Record<string, unknown> }>
}
