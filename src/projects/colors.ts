/** The palette's slots a project's color is one of: `--series-1` … `--series-8` on the page. */
export const PROJECT_COLORS = 8

export const isColor = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= PROJECT_COLORS

/**
 * The color of each project by its key, in the order of the config: its own, or the first one no project has as its own
 * and no earlier project was given. A config without colors gets the colors of the positions, as before BTN-207; a
 * project past the free ones gets none.
 */
export function colorsOf(keys: string[], own: Record<string, number>): Record<string, number> {
  const taken = new Set(Object.values(own))
  const free = Array.from({ length: PROJECT_COLORS }, (_, index) => index + 1).filter((color) => !taken.has(color))
  return Object.fromEntries(
    keys.flatMap((key) => {
      const color = own[key] ?? free.shift()
      return color === undefined ? [] : [[key, color]]
    }),
  )
}
