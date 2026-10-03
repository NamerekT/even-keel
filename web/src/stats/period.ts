export interface DayRange {
  from: string
  to: string
}

export type Preset = '7d' | '30d' | 'month' | 'last-month' | '3m' | 'year' | 'all'
export type Step = 'day' | 'week' | 'month'
export type PeriodChoice = { preset: Preset } | DayRange

export const PRESETS: { preset: Preset; label: string }[] = [
  { preset: '7d', label: '7 дней' },
  { preset: '30d', label: '30 дней' },
  { preset: 'month', label: 'Этот месяц' },
  { preset: 'last-month', label: 'Прошлый месяц' },
  { preset: '3m', label: '3 месяца' },
  { preset: 'year', label: 'Этот год' },
  { preset: 'all', label: 'Всё время' },
]

const MONTHS_OF_DAY = ['янв', 'февр', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сент', 'окт', 'нояб', 'дек']
export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
export const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

const DAY_MS = 86_400_000

export function isPreset(text: string): text is Preset {
  return PRESETS.some((each) => each.preset === text)
}

export function localDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function toUtc(day: string): Date {
  return new Date(`${day}T00:00:00Z`)
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(day: string, days: number): string {
  return fromUtc(new Date(toUtc(day).getTime() + days * DAY_MS))
}

export function monthEnd(day: string): string {
  const date = toUtc(day)
  return fromUtc(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)))
}

export function addMonths(day: string, months: number): string {
  const date = toUtc(day)
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1))
  const last = Number(monthEnd(fromUtc(first)).slice(8))
  return fromUtc(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(date.getUTCDate(), last))))
}

export function dayCount(range: DayRange): number {
  return Math.round((toUtc(range.to).getTime() - toUtc(range.from).getTime()) / DAY_MS) + 1
}

export function resolvePeriod(choice: PeriodChoice, today: string, firstDay: string | null): DayRange {
  if (!('preset' in choice)) return { from: choice.from, to: choice.to }
  const month = `${today.slice(0, 7)}-01`
  switch (choice.preset) {
    case '7d':
      return { from: addDays(today, -6), to: today }
    case '30d':
      return { from: addDays(today, -29), to: today }
    case '3m':
      return { from: addDays(addMonths(today, -3), 1), to: today }
    case 'month':
      return { from: month, to: today }
    case 'last-month': {
      const from = addMonths(month, -1)
      return { from, to: monthEnd(from) }
    }
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today }
    case 'all':
      return { from: firstDay !== null && firstDay < today ? firstDay : today, to: today }
  }
}

function monthsSpan(range: DayRange): number {
  const from = toUtc(range.from)
  const to = toUtc(range.to)
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth() + 1
}

function wholeYears(range: DayRange, today: string): number | null {
  if (!range.from.endsWith('-01-01')) return null
  const endsYear = range.to.endsWith('-12-31') || (range.to === today && range.to.slice(0, 4) === today.slice(0, 4))
  return endsYear ? Number(range.to.slice(0, 4)) - Number(range.from.slice(0, 4)) + 1 : null
}

function wholeMonths(range: DayRange, today: string): number | null {
  if (!range.from.endsWith('-01')) return null
  return range.to === monthEnd(range.to) || range.to === today ? monthsSpan(range) : null
}

export function shiftRange(range: DayRange, direction: -1 | 1, today: string): DayRange {
  const years = wholeYears(range, today)
  const months = years !== null ? years * 12 : wholeMonths(range, today)
  if (months !== null) {
    const from = addMonths(range.from, direction * months)
    if (from > today) return range
    const to = addDays(addMonths(from, months), -1)
    return { from, to: to > today ? today : to }
  }
  const length = dayCount(range)
  const shifted = { from: addDays(range.from, direction * length), to: addDays(range.to, direction * length) }
  if (shifted.to <= today) return shifted
  return { from: addDays(today, 1 - length), to: today }
}

export function previousRange(range: DayRange): DayRange {
  const length = dayCount(range)
  return { from: addDays(range.from, -length), to: addDays(range.from, -1) }
}

export function autoStep(range: DayRange): Step {
  const days = dayCount(range)
  if (days <= 62) return 'day'
  if (days <= 366) return 'week'
  return 'month'
}

export function bucketOf(day: string, step: Step): string {
  if (step === 'day') return day
  if (step === 'month') return `${day.slice(0, 7)}-01`
  const weekday = (toUtc(day).getUTCDay() + 6) % 7
  return addDays(day, -weekday)
}

export function nextBucket(bucket: string, step: Step): string {
  if (step === 'day') return addDays(bucket, 1)
  if (step === 'week') return addDays(bucket, 7)
  return addMonths(bucket, 1)
}

export function buckets(range: DayRange, step: Step): string[] {
  const list: string[] = []
  for (let bucket = bucketOf(range.from, step); bucket <= range.to; bucket = nextBucket(bucket, step)) list.push(bucket)
  return list
}

export function formatDay(day: string, withYear = true): string {
  const text = `${Number(day.slice(8))} ${MONTHS_OF_DAY[Number(day.slice(5, 7)) - 1]}`
  return withYear ? `${text} ${day.slice(0, 4)}` : text
}

export function formatRange(range: DayRange): string {
  if (range.from === range.to) return formatDay(range.from)
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4)
  return `${formatDay(range.from, !sameYear)} — ${formatDay(range.to)}`
}

export function formatBucket(bucket: string, step: Step): string {
  if (step === 'month') return `${MONTHS_SHORT[Number(bucket.slice(5, 7)) - 1]} ${bucket.slice(0, 4)}`
  return formatDay(bucket, false)
}
