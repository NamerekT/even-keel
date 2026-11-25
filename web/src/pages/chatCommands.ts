import { CHAT_COMMANDS, headOf, type MenuEntry } from '../../../src/sessions/commands.js'
import type { Language } from '../../../src/language.js'

/**
 * A row of the chat's `/` menu (BTN-1695): one of Even Keel's commands, expanded by the service, or an entry the session
 * expands itself — the user's command or skill, a skill of the project's packages.
 */
export interface MenuItem {
  name: string
  group: 'even-keel' | MenuEntry['from']
  description: string
  args: string
}

/** Even Keel's own commands in the page's language. */
export function evenKeelItems(language: Language): MenuItem[] {
  return CHAT_COMMANDS.map((command) => ({ name: command.name, group: 'even-keel', description: command.description[language], args: command.args[language] }))
}

/** The menu: Even Keel's commands first (`evenKeel` — a task's session), then the session's entries; on one name Even Keel's wins. */
export function menuItems(language: Language, evenKeel: boolean, entries: readonly MenuEntry[]): MenuItem[] {
  const own = evenKeel ? evenKeelItems(language) : []
  const taken = new Set(own.map((item) => item.name))
  const rest = entries.filter((entry) => !taken.has(entry.name)).map((entry): MenuItem => ({ name: entry.name, group: entry.from, description: entry.description, args: entry.args }))
  return [...own, ...rest]
}

/** The items whose name holds what was typed after `/`. */
export function matchingItems(typed: string, items: readonly MenuItem[]): MenuItem[] {
  const query = typed.toLowerCase()
  return items.filter((item) => item.name.toLowerCase().includes(query))
}

/** A known item at the start of the field; `start` and `end` — where `/name` stands. */
export function typedItem(text: string, items: readonly MenuItem[]): { item: MenuItem; start: number; end: number } | null {
  const head = headOf(text)
  const item = head === null ? undefined : items.find((each) => each.name === head.name)
  return head === null || item === undefined ? null : { item, start: head.start, end: head.end }
}

/** What the commands menu filters by: the name typed after a `/` that starts the field, while nothing follows it. */
export function menuQuery(text: string): string | null {
  return /^\s*\/(\S*)$/.exec(text)?.[1] ?? null
}

/** The field once a command is picked: the spaces before the slash kept, a space after the name for its words. */
export function withCommand(text: string, name: string): string {
  return `${/^\s*/.exec(text)![0]}/${name} `
}

/** Muted text after the field's own: `gap` — it needs a space before it. */
export type Ghost = { kind: 'filter'; gap: false } | { kind: 'args'; text: string; gap: boolean }

export function ghostOf(text: string, language: Language, items: readonly MenuItem[] = evenKeelItems(language)): Ghost | null {
  if (/^\s*\/$/.test(text)) return { kind: 'filter', gap: false }
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
