/** The page of a machine (BTN-1272). */
export const machinePath = (id: string): string => `/machines/${encodeURIComponent(id)}`

/** How close two colours may come before a machine's mark reads as an account's dot: a distance in RGB, out of 441. */
const NEAR = 64

const rgbOf = (hex: string): [number, number, number] | undefined => {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  return match === null ? undefined : [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)]
}

/** Whether `color` is close to one of the account colours (`--series-*` of the theme shown): a quiet warning on the page. */
export function nearAccountColor(color: string, accounts: readonly string[]): boolean {
  const own = rgbOf(color)
  if (own === undefined) return false
  return accounts.some((each) => {
    const other = rgbOf(each)
    return other !== undefined && Math.hypot(own[0] - other[0], own[1] - other[1], own[2] - other[2]) < NEAR
  })
}

/** The account colours of the theme shown, read from the page's tokens. */
export function accountColors(): string[] {
  const style = getComputedStyle(document.documentElement)
  return Array.from({ length: 8 }, (_, index) => style.getPropertyValue(`--series-${index + 1}`).trim()).filter((value) => value !== '')
}
