import { en } from './en.js'

// A message the server shows on the page: a code the page translates, its values, and text from git or
// the CLI that stays as it is. The log and the English page read it through `en`.
export type NoticeCode = keyof typeof en
export type NoticeParams<K extends NoticeCode> = Parameters<(typeof en)[K]> extends [infer P] ? P : Record<string, never>
export type NoticeTexts = { [K in NoticeCode]: (params: NoticeParams<K>) => string }

export interface NoticeExtras {
  detail?: string
  cause?: Notice
  items?: Notice[]
}

export type Notice = { [K in NoticeCode]: { code: K; params: NoticeParams<K> } & NoticeExtras }[NoticeCode]

export function notice<K extends NoticeCode>(code: K, params: NoticeParams<K>, extras: NoticeExtras = {}): Notice {
  return { code, params, ...extras } as Notice
}

export function textNotice(text: string): Notice {
  return { code: 'text', params: { text } }
}

export class NoticeError extends Error {
  constructor(
    readonly notice: Notice,
    options?: ErrorOptions,
  ) {
    super(englishOf(notice), options)
  }
}

export function fail<K extends NoticeCode>(code: K, params: NoticeParams<K>, extras: NoticeExtras = {}, options?: ErrorOptions): NoticeError {
  return new NoticeError(notice(code, params, extras), options)
}

export function noticeOf(error: unknown): Notice {
  if (error instanceof NoticeError) return error.notice
  return textNotice(error instanceof Error ? error.message : String(error))
}

/**
 * `noticeOf` with the error under it as the detail (BTN-674): `fail(…, {}, { cause })` keeps an fs or database error
 * there, and the notice alone drops it. A notice that has a detail or a cause of its own is kept as it is.
 */
export function noticeWithCause(error: unknown): Notice {
  const base = noticeOf(error)
  const under = plainCauseOf(error)
  if (under === undefined || base.detail !== undefined || base.cause !== undefined) return base
  return { ...base, detail: under.message }
}

/** The error under `error` as a log line — its message, code and path — or undefined when there is none. */
export function causeLine(error: unknown): string | undefined {
  const under = plainCauseOf(error)
  if (under === undefined) return undefined
  const fields = under as { code?: unknown; path?: unknown; dest?: unknown }
  const extras = (['code', 'path', 'dest'] as const)
    .filter((name) => {
      const value = fields[name]
      return typeof value === 'string' && !under.message.includes(value)
    })
    .map((name) => `${name} ${fields[name] as string}`)
  return `cause: ${under.message}${extras.length > 0 ? ` (${extras.join(', ')})` : ''}`
}

function plainCauseOf(error: unknown): Error | undefined {
  const under = error instanceof Error ? error.cause : undefined
  if (under === undefined || under instanceof NoticeError) return undefined
  return under instanceof Error ? under : new Error(String(under))
}

// A stored or received value: an old plain string, a notice, or something broken that is still shown.
export function asNotice(value: unknown): Notice {
  if (typeof value === 'string') return textNotice(value)
  if (typeof value === 'object' && value !== null && Object.hasOwn(en, (value as { code?: unknown }).code as string)) return value as Notice
  return textNotice(JSON.stringify(value))
}

export function renderNotice(notice: Notice, texts: NoticeTexts): string {
  const render = Object.hasOwn(texts, notice.code) ? (texts[notice.code] as (params: unknown) => string) : undefined
  let text = render === undefined ? notice.code : render(notice.params)
  if (notice.cause !== undefined) text = joined(text, renderNotice(notice.cause, texts))
  if (notice.items !== undefined && notice.items.length > 0) text = `${text}:\n${notice.items.map((item) => renderNotice(item, texts)).join('\n')}`
  const detail = notice.detail?.replace(/^\s*\n/, '').trimEnd() ?? ''
  return detail === '' ? text : joined(text, detail)
}

export function englishOf(notice: Notice): string {
  return renderNotice(notice, en)
}

/**
 * The text with every project id in it shown by the project's label (BTN-271): the service names projects by id, and a
 * log line or a notice says the id where it names one. `labels` is the label of each project by its id.
 */
export function withLabels(text: string, labels: Readonly<Record<string, string>>): string {
  let out = text
  for (const [project, label] of Object.entries(labels)) if (out.includes(project)) out = out.replaceAll(project, label)
  return out
}

export function sameNotice(a: Notice | null, b: Notice | null): boolean {
  return a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b))
}

// A head that is a whole sentence ("…, then resume the chain.") takes its tail as the next one, not after a colon.
function joined(head: string, tail: string): string {
  const mark = /[.!?]$/.test(head) ? '' : ':'
  return tail.includes('\n') ? `${head}${mark}\n${tail}` : `${head}${mark} ${tail}`
}
