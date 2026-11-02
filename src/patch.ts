/**
 * The parts of an event's data sent by their entries, each with the field that names an entry: a live session changes
 * one session of hundreds, not the list (BTN-695).
 */
export type KeyedParts = Record<string, string>

/**
 * What changed in the data of an event sent in parts (`EventHub`) since its last frame, sent as `<event>Patch`; the page
 * applies it with `applyPatch`. A part absent from all three is as it was.
 */
export interface Patch {
  /** The parts that changed, whole; a keyed part whose entries do not name themselves apart is here too. */
  parts?: Record<string, unknown>
  gone?: string[]
  /** The changed entries of each keyed part, and its order of ids when that changed. */
  keyed?: Record<string, { by: string; order?: string[]; changed: unknown[] }>
}
