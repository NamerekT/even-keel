const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const STAMP = /^\d{4}-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/

/**
 * A moment as the clock of `tz` shows it, with its offset: `2026-11-10T03:40:00+01:00`. The badge's state carries its
 * times so (BTN-970): the picture prints the digits as written, and neither the state nor the Worker names a zone.
 */
export function localStamp(at: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at)
  const part = (type: string) => parts.find((each) => each.type === type)!.value
  const local = `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`
  const offset = Math.round((Date.parse(`${local}Z`) - Math.floor(at.getTime() / 1000) * 1000) / 60_000)
  const two = (value: number) => String(value).padStart(2, '0')
  return `${local}${offset < 0 ? '-' : '+'}${two(Math.floor(Math.abs(offset) / 60))}:${two(Math.abs(offset) % 60)}`
}

/** The day of a moment in `tz`: `2026-11-10`. */
export function localDay(at: Date, tz: string): string {
  return localStamp(at, tz).slice(0, 10)
}

/**
 * A local stamp or day as the badge prints it, the month by its name since `11-10` reads two ways: `Nov 10` and, of a
 * stamp, `03:40`. `null` — not such a text.
 */
export function printed(stamp: string): { day: string; time: string | null } | null {
  const match = STAMP.exec(stamp)
  const month = match === null ? undefined : MONTHS[Number(match[1]) - 1]
  if (match === null || month === undefined) return null
  return { day: `${month} ${Number(match[2])}`, time: match[3] === undefined ? null : `${match[3]}:${match[4]}` }
}
