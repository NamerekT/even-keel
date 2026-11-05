/**
 * The warnings of the page a person may turn off (BTN-759), by the scope of their banner: a project's banner is turned
 * off for that project, with Even Keel's value as the default of every project; a shared banner for all of Even Keel.
 * Errors that hold a chain are no kind: they only take "Got it". Only types and data here: the page imports it.
 */
export const NOTICE_KINDS = {
  'protection.noRules': 'project',
  'protection.remote': 'project',
  'branch.drift': 'project',
  'cli.versions': 'global',
  'cli.check': 'global',
  'usage.unread': 'global',
  unattended: 'global',
} as const satisfies Record<string, 'global' | 'project'>

export type NoticeKind = keyof typeof NOTICE_KINDS

export const isNoticeKind = (value: unknown): value is NoticeKind => typeof value === 'string' && Object.hasOwn(NOTICE_KINDS, value)

/** The kinds a project's own `notices` may hold. */
export const PROJECT_KINDS = (Object.keys(NOTICE_KINDS) as NoticeKind[]).filter((kind) => NOTICE_KINDS[kind] === 'project')

/** Whether a kind is shown: the project's own value over Even Keel's, shown by default. */
export const noticeShown = (kind: NoticeKind, shared: Readonly<Record<string, boolean>>, own: Readonly<Record<string, boolean>> = {}): boolean =>
  own[kind] ?? shared[kind] ?? true

/** At most this many "Got it" marks are kept: the oldest go first. */
export const DISMISSED_LIMIT = 300

/** The "Got it" marks with `entries` merged in, the newest last and the oldest dropped over `DISMISSED_LIMIT`. */
export function withDismissed(current: Readonly<Record<string, string>>, entries: Readonly<Record<string, string>>): Record<string, string> {
  const kept = Object.entries(current).filter(([id]) => !Object.hasOwn(entries, id))
  return Object.fromEntries([...kept, ...Object.entries(entries)].slice(-DISMISSED_LIMIT))
}
