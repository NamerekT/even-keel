import { isLanguage, type Language } from '../../../src/language.js'
import { noticeParts, renderNotice, withLabels, type Notice, type NoticeTexts } from '../../../src/notice/notice.js'
import { en } from './en.js'
import { fieldsEn, type FieldTexts } from './fields-en.js'
import { fieldsRu } from './fields-ru.js'
import { ru, type Messages } from './ru.js'
import { overageEn } from './overage-en.js'
import { overageRu } from './overage-ru.js'
import { localMoment } from '../moment.js'

export type { Messages }

const MESSAGES: Record<Language, Messages> = { en, ru }

export let language: Language = 'en'
export let t: Messages = en

export const overageTexts = localized((each) => each === 'ru' ? overageRu : overageEn)

export function setLanguage(next: Language): void {
  language = next
  t = MESSAGES[next]
  if (typeof document !== 'undefined') document.documentElement.lang = next
}

let labels: Readonly<Record<string, string>> = {}

// What a server message shows a project by: the service names it by id (BTN-271).
export function setProjectLabels(next: Readonly<Record<string, string>>): void {
  labels = next
}

let accountNames: Readonly<Record<string, string>> = {}

// What a server message shows an account by: the service names it by its folder key, the page by `accountName`.
export function setAccountNames(next: Readonly<Record<string, string>>): void {
  accountNames = next
}

// The account of a server message's folder key; a value that is no known key (an e-mail, a folder gone) as it is.
export function sayAccount(key: string): string {
  return Object.hasOwn(accountNames, key) ? accountNames[key]! : key
}

function namedAccounts(notice: Notice): Notice {
  const params = notice.params as { account?: unknown }
  return {
    ...notice,
    ...(typeof params.account === 'string' && { params: { ...params, account: sayAccount(params.account) } }),
    ...(notice.cause !== undefined && { cause: namedAccounts(notice.cause) }),
    ...(notice.items !== undefined && { items: notice.items.map(namedAccounts) }),
  } as Notice
}

// A server message in the page's language.
export function say(notice: Notice): string {
  return withLabels(sayIds(notice), labels)
}

// The same, its projects still by their ids, for `ProjectLinks` to make links of them (BTN-319).
export function sayIds(notice: Notice): string {
  return renderNotice(namedAccounts(notice), pageTexts(), t.advice)
}

function pageTexts(): NoticeTexts {
  return {
    ...t.notice,
    'chain.limitSpent': (p) => t.notice['chain.limitSpent']({
      ...p,
      until: localMoment(p.until, new Date(), language),
      provider: p.provider === undefined ? undefined : (t.account.agents as Record<string, string>)[p.provider] ?? p.provider,
    }),
  }
}

/** A server message as a toast and a band show it (BTN-1149), its projects by their ids as in `sayIds`. */
export interface SaidLines {
  /** What happened, as the text has it: it may go after a subject, so its first letter is the text's own. */
  head: string
  /** The line under it, in whole sentences: the causes, then the one thing to do; `null` when the message is its head alone. */
  under: string | null
}

export function sayLines(notice: Notice): SaidLines {
  const { head, reason, advice } = noticeParts(namedAccounts(notice), pageTexts(), t.advice)
  const under = [reason, advice].filter((each) => each !== undefined).map(sentence).join(' ')
  return { head, under: under === '' ? null : under }
}

/** A text of `sayIds` or `sayLines` with its projects by their labels, where it cannot hold links. */
export function labelled(text: string): string {
  return withLabels(text, labels)
}

/** A text that reads after a colon, as a sentence of its own: a capital first, a full stop last unless it ends in lines of output. */
export function sentence(text: string): string {
  const capital = text.charAt(0).toLocaleUpperCase(language) + text.slice(1)
  return /[.!?…:]$/.test(capital) || capital.includes('\n') ? capital : `${capital}.`
}

const FIELDS: Record<Language, FieldTexts> = { en: fieldsEn, ru: fieldsRu }

// A refused setting as its field says it: by the value, without the path of the config the server's text names (BTN-297).
export function sayAtField(notice: Notice): string {
  const texts = FIELDS[language] as Partial<Record<Notice['code'], (params: unknown) => string>>
  const render = texts[notice.code]
  return render === undefined ? say(notice) : withLabels(render(notice.params), labels)
}

// The configured language wins; otherwise the first browser language the page knows, English if none.
export function pickLanguage(configured: Language | null, browser: readonly string[]): Language {
  if (configured !== null) return configured
  for (const tag of browser) {
    const base = tag.toLowerCase().split('-')[0]
    if (isLanguage(base)) return base
  }
  return 'en'
}

// A formatter built for the current language and rebuilt when it changes.
export function localized<T>(make: (language: Language) => T): () => T {
  let cached: { language: Language; value: T } | null = null
  return () => {
    if (cached === null || cached.language !== language) cached = { language, value: make(language) }
    return cached.value
  }
}
