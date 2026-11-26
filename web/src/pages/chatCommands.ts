import { CHAT_COMMANDS, type MenuEntry } from '../../../src/sessions/commands.js'
import type { Language } from '../../../src/language.js'

/** What a session calls an entry by: Claude and Even Keel's commands `/name`, Codex its skills `$name` (BTN-1737). */
export type Sigil = '/' | '$'

/**
 * A row of the chat's `/` menu (BTN-1695): one of Even Keel's commands, expanded by the service, or an entry the session
 * expands itself — the user's command or skill, a skill of the project's packages.
 */
export interface MenuItem {
  name: string
  sigil: Sigil
  group: 'even-keel' | MenuEntry['from']
  description: string
  args: string
}

/** Even Keel's own commands in the page's language. */
export function evenKeelItems(language: Language): MenuItem[] {
  return CHAT_COMMANDS.map((command) => ({ name: command.name, sigil: '/', group: 'even-keel', description: command.description[language], args: command.args[language] }))
}

/**
 * The menu: Even Keel's commands first (`evenKeel` — a task's session), then the session's entries, called by `sigil`;
 * on one name Even Keel's wins.
 */
export function menuItems(language: Language, evenKeel: boolean, entries: readonly MenuEntry[], sigil: Sigil = '/'): MenuItem[] {
  const own = evenKeel ? evenKeelItems(language) : []
  const taken = new Set(own.map((item) => item.name))
  const rest = entries.filter((entry) => !taken.has(entry.name)).map((entry): MenuItem => ({ name: entry.name, sigil, group: entry.from, description: entry.description, args: entry.args }))
  return [...own, ...rest]
}

/** The items whose name holds what was typed: after a `/` every item, after a `$` only those called by it. */
export function matchingItems(typed: string, items: readonly MenuItem[], sigil: Sigil): MenuItem[] {
  const query = typed.toLowerCase()
  return items.filter((item) => (sigil === '/' || item.sigil === sigil) && item.name.toLowerCase().includes(query))
}

const HEAD = /^(\s*)([/$])(\S+)(?=\s|$)/

/** A known item at the start of the field, by its own sigil; `start` and `end` — where `/name` or `$name` stands. */
export function typedItem(text: string, items: readonly MenuItem[]): { item: MenuItem; start: number; end: number } | null {
  const head = HEAD.exec(text)
  const item = head === null ? undefined : items.find((each) => each.sigil === head[2] && each.name === head[3])
  return head === null || item === undefined ? null : { item, start: head[1]!.length, end: head[0].length }
}

/** What the commands menu filters by: the name typed after a `/` or `$` that starts the field, while nothing follows it. */
export function menuQuery(text: string): { sigil: Sigil; typed: string } | null {
  const match = /^\s*([/$])(\S*)$/.exec(text)
  return match === null ? null : { sigil: match[1] as Sigil, typed: match[2]! }
}

/** The field once a command is picked: the spaces before it kept, the item's sigil, a space after the name for its words. */
export function withCommand(text: string, name: string, sigil: Sigil = '/'): string {
  return `${/^\s*/.exec(text)![0]}${sigil}${name} `
}

/** Muted text after the field's own: `gap` — it needs a space before it. */
export type Ghost = { kind: 'filter'; gap: false } | { kind: 'args'; text: string; gap: boolean }

export function ghostOf(text: string, language: Language, items: readonly MenuItem[] = evenKeelItems(language)): Ghost | null {
  if (/^\s*\/$/.test(text)) return { kind: 'filter', gap: false }
  if (/^\s*\$$/.test(text) && items.some((item) => item.sigil === '$')) return { kind: 'filter', gap: false }
  const typed = typedItem(text, items)
  if (typed === null || typed.item.args === '' || text.slice(typed.end).trim() !== '') return null
  return { kind: 'args', text: typed.item.args, gap: typed.end === text.length }
}

/** A caret moved inside a command takes the whole command, so it is passed and picked as one piece. */
export function snappedSelection(text: string, start: number, end: number, items: readonly MenuItem[] = evenKeelItems('en')): [number, number] | null {
  const typed = typedItem(text, items)
  if (typed === null || start !== end || start <= typed.start || start >= typed.end) return null
  return [typed.start, typed.end]
}

/** Backspace right after a command or Delete right before it removes the whole command. */
export function tokenCut(text: string, caret: number, key: string, items: readonly MenuItem[] = evenKeelItems('en')): { text: string; caret: number } | null {
  const typed = typedItem(text, items)
  if (typed === null) return null
  if ((key === 'Backspace' && caret === typed.end) || (key === 'Delete' && caret === typed.start)) {
    return { text: text.slice(0, typed.start) + text.slice(typed.end), caret: typed.start }
  }
  return null
}
