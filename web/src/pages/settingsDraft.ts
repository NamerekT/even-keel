/** A field as a settings form holds it: text, a switch, or the picks of a list. */
export type Value = string | boolean | readonly string[]
export type Values = Readonly<Record<string, Value>>

/** A form's draft: what each field started from, and what is in it now. */
export interface Draft {
  base: Values
  edit: Values
}

/** Whether two values of a field come to the same thing, as the service would store them. */
export type Same = (key: string, a: Value, b: Value) => boolean

/**
 * The draft against the file as it is now. Where the file still holds what a field started from, the field stays as it is.
 * Where the file changed, a field nobody edited takes the new value, a field edited into that value starts from it,
 * and an edited one keeps its edit and its base: the file then differs from the base, which `conflicts` shows.
 */
export function rebase(draft: Draft | undefined, saved: Values, same: Same): Draft {
  if (draft === undefined) return { base: saved, edit: saved }
  const base: Record<string, Value> = {}
  const edit: Record<string, Value> = {}
  for (const [key, now] of Object.entries(saved)) {
    const started = draft.base[key]
    const typed = draft.edit[key]
    if (started === undefined || typed === undefined) {
      base[key] = edit[key] = now
    } else if (same(key, started, now)) {
      base[key] = started
      edit[key] = typed
    } else if (same(key, typed, started)) {
      base[key] = edit[key] = now
    } else {
      base[key] = same(key, typed, now) ? now : started
      edit[key] = typed
    }
  }
  return { base, edit }
}

export const edited = (draft: Draft, key: string, value: Value): Draft => ({ ...draft, edit: { ...draft.edit, [key]: value } })

/** The fields among `keys` whose value differs from what they started from. */
export const changed = (draft: Draft, keys: readonly string[], same: Same): string[] => keys.filter((key) => !same(key, draft.edit[key]!, draft.base[key]!))

/** The changed fields among `keys` that the file changed too since the draft started. */
export const conflicts = (draft: Draft, saved: Values, keys: readonly string[], same: Same): string[] =>
  changed(draft, keys, same).filter((key) => !same(key, saved[key]!, draft.base[key]!))

/** The draft with the fields of `keys` back to what the file holds now. */
export function reverted(draft: Draft, saved: Values, keys: readonly string[]): Draft {
  const back = Object.fromEntries(keys.map((key) => [key, saved[key]!]))
  return { base: { ...draft.base, ...back }, edit: { ...draft.edit, ...back } }
}

/** What a save of the fields of `keys` sends: the base with only their edits, and the base to judge it against. */
export function sent(draft: Draft, keys: readonly string[]): { form: Values; base: Values } {
  return { form: { ...draft.base, ...Object.fromEntries(keys.map((key) => [key, draft.edit[key]!])) }, base: draft.base }
}
