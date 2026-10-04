import type { ImportPrecision, RulePurpose } from '../../../src/stats/rule-imports.js'
import type { RuleKind, RuleMark, RuleSet } from '../../../src/stats/rules.js'
import { bucketOf, dayCount, localDay, nextBucket, addDays, type DayRange, type Step } from './period.js'

export const RULE_KIND_LABELS: [RuleKind, string][] = [
  ['claude_md', 'CLAUDE.md'],
  ['skill', 'навыки'],
  ['hook', 'хуки'],
  ['settings', 'настройки'],
  ['agent', 'агенты'],
]

// Memory makes no marks (filterSets), so it has no chip.
export const MARK_KINDS: RuleKind[] = RULE_KIND_LABELS.map(([kind]) => kind)

export interface MarkPlace {
  mark: RuleMark
  offset: number
}

export const markKey = (mark: RuleMark): string => mark.sets[0]!.id

// Marks by chart bucket; `offset` is where the mark's last day sits inside its bucket, 0..1.
export function markPlaces(marks: RuleMark[], range: DayRange, step: Step): Map<string, MarkPlace[]> {
  const places = new Map<string, MarkPlace[]>()
  for (const mark of marks) {
    const day = localDay(new Date(mark.toAt))
    if (day < range.from || day > range.to) continue
    const bucket = bucketOf(day, step)
    const days = dayCount({ from: bucket, to: addDays(nextBucket(bucket, step), -1) })
    const index = dayCount({ from: bucket, to: day }) - 1
    places.set(bucket, [...(places.get(bucket) ?? []), { mark, offset: (index + 0.5) / days }])
  }
  return places
}

// A plain click picks one mark (or drops it); with a modifier the click adds or replaces the second mark.
export function pickMark(picked: string[], key: string, extend: boolean): string[] {
  if (!extend) return picked.length === 1 && picked[0] === key ? [] : [key]
  if (picked.includes(key)) return picked.filter((each) => each !== key)
  return picked.length === 0 ? [key] : [picked[0]!, key]
}

export function pickedSpan(marks: RuleMark[], picked: string[]): { before: string; after: string; marks: RuleMark[] } | null {
  const chosen = marks.filter((mark) => picked.includes(markKey(mark)))
  if (chosen.length === 0) return null
  const before = chosen.map((mark) => mark.fromAt).reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b))
  const after = chosen.map((mark) => mark.toAt).reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b))
  const inside = marks.filter((mark) => Date.parse(mark.fromAt) >= Date.parse(before) && Date.parse(mark.toAt) <= Date.parse(after))
  return { before, after, marks: inside }
}

export function shortPath(display: string): string {
  const parts = display.split('/')
  return parts.length <= 3 ? display : `…/${parts.slice(-3).join('/')}`
}

export const PURPOSE_LABELS: [RulePurpose, string][] = [
  ['economy', 'экономия'],
  ['quality', 'качество'],
  ['process', 'процесс'],
  ['infra', 'инфраструктура'],
]

// `null` means every chip is on.
export function toggleChip<T extends string>(on: T[] | null, chip: T, all: readonly T[]): T[] | null {
  const current = on ?? all
  const next = all.filter((each) => (each === chip ? !current.includes(chip) : current.includes(each)))
  return next.length === all.length ? null : next
}

export function driftText(drift: number | null): string | null {
  if (drift === null || drift === 0) return null
  const minutes = Math.abs(drift) / 60_000
  const size = minutes < 60 ? `${Math.round(minutes)} мин` : minutes < 48 * 60 ? `${Math.round(minutes / 60)} ч` : `${Math.round(minutes / 1440)} дн`
  return `в транскрипте на ${size} ${drift > 0 ? 'позже' : 'раньше'}`
}

export function precisionText(precision: ImportPrecision): string | null {
  return precision === 'hour' ? '±час' : precision === 'day' ? '±день' : null
}

export function setTitle(set: RuleSet): string {
  if (set.task !== null) return set.task
  if (set.title !== null) return set.title
  if (set.sessionId !== null) return 'сессия без задачи'
  return set.id.startsWith('i:') ? 'из импорта' : 'вручную'
}

export function markTitle(mark: RuleMark): string {
  return [...new Set(mark.sets.map(setTitle))].join(', ')
}

// Global files lose the `~/.claude/` they all share; elsewhere the folder above `.claude`, or the file's own folder, names the place.
export function fileLabel(display: string): string {
  if (display.startsWith('~/.claude/')) return display.slice('~/.claude/'.length)
  if (display.startsWith('~/')) return display
  const parts = display.split('/')
  const config = parts.indexOf('.claude')
  return parts.slice(Math.max(config > 0 ? config - 1 : parts.length - 2, 0)).join('/')
}

export interface MarkSummary {
  reasons: string[]
  kinds: string
  who: string[]
  files: number
  added: number
  removed: number
}

const KIND_ORDER: RuleKind[] = [...MARK_KINDS, 'memory']
const KIND_NAMES = new Map<RuleKind, string>([...RULE_KIND_LABELS, ['memory', 'память']])

export function markSummary(mark: RuleMark): MarkSummary {
  const files = new Map<string, RuleKind>()
  let added = 0
  let removed = 0
  for (const file of mark.sets.flatMap((set) => set.files)) {
    files.set(file.key, file.kind)
    added += file.added
    removed += file.removed
  }
  const counts = KIND_ORDER.map((kind) => [kind, [...files.values()].filter((each) => each === kind).length] as const).filter(([, count]) => count > 0)
  const tasks = mark.sets.flatMap((set) => (set.task === null ? [] : [set.task]))
  const untasked = mark.sets.filter((set) => set.task === null)
  const sessions = untasked.flatMap((set) => (set.title === null ? [] : [`«${set.title}»`]))
  const others = untasked.filter((set) => set.title === null).map(setTitle)
  return {
    reasons: [...new Set(mark.sets.map((set) => set.note?.reason ?? '').filter((reason) => reason !== ''))],
    kinds: counts.map(([kind, count]) => (count > 1 ? `${KIND_NAMES.get(kind)} ×${count}` : KIND_NAMES.get(kind))).join(', '),
    who: [...new Set([...tasks, ...sessions, ...others])],
    files: files.size,
    added,
    removed,
  }
}
