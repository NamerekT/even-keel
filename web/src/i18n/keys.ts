/** How many task keys a tip lists before it counts the rest (BTN-1189). */
export const KEYS_SHOWN = 20

/** The first `KEYS_SHOWN` keys joined by commas, then the language's "and N more" for the rest. */
export function keyList(ids: readonly string[], more: (count: number) => string): string {
  const shown = ids.slice(0, KEYS_SHOWN).join(', ')
  return ids.length > KEYS_SHOWN ? `${shown} ${more(ids.length - KEYS_SHOWN)}` : shown
}

export const keysEn = (ids: readonly string[]): string => keyList(ids, (count) => `and ${count} more`)
export const keysRu = (ids: readonly string[]): string => keyList(ids, (count) => `и ещё ${count}`)
