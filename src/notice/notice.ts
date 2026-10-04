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

// A stored or received value: an old plain string, a notice, or something broken that is still shown.
export function asNotice(value: unknown): Notice {
  if (typeof value === 'string') return textNotice(value)
  if (typeof value === 'object' && value !== null && Object.hasOwn(en, (value as { code?: unknown }).code as string)) return value as Notice
  return textNotice(JSON.stringify(value))
}

export function renderNotice(notice: Notice, texts: NoticeTexts): string {
  const render = texts[notice.code] as ((params: unknown) => string) | undefined
  let text = render === undefined ? notice.code : render(notice.params)
  if (notice.cause !== undefined) text = joined(text, renderNotice(notice.cause, texts))
  if (notice.items !== undefined && notice.items.length > 0) text = `${text}:\n${notice.items.map((item) => renderNotice(item, texts)).join('\n')}`
  const detail = notice.detail?.replace(/^\s*\n/, '').trimEnd() ?? ''
  return detail === '' ? text : joined(text, detail)
}

export function englishOf(notice: Notice): string {
  return renderNotice(notice, en)
}

export function sameNotice(a: Notice | null, b: Notice | null): boolean {
  return a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b))
}

function joined(head: string, tail: string): string {
  return tail.includes('\n') ? `${head}:\n${tail}` : `${head}: ${tail}`
}
