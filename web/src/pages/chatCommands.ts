import { commandIn } from '../../../src/sessions/commands.js'
import type { Language } from '../../../src/language.js'

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

export function ghostOf(text: string, language: Language): Ghost | null {
  if (/^\s*\/$/.test(text)) return { kind: 'filter', gap: false }
  const typed = commandIn(text)
  if (typed === null || text.slice(typed.end).trim() !== '') return null
  return { kind: 'args', text: typed.command.args[language], gap: typed.end === text.length }
}

/** A caret moved inside a command takes the whole command, so it is passed and picked as one piece. */
export function snappedSelection(text: string, start: number, end: number): [number, number] | null {
  const typed = commandIn(text)
  if (typed === null || start !== end || start <= typed.start || start >= typed.end) return null
  return [typed.start, typed.end]
}

/** Backspace right after a command or Delete right before it removes the whole command. */
export function tokenCut(text: string, caret: number, key: string): { text: string; caret: number } | null {
  const typed = commandIn(text)
  if (typed === null) return null
  if ((key === 'Backspace' && caret === typed.end) || (key === 'Delete' && caret === typed.start)) {
    return { text: text.slice(0, typed.start) + text.slice(typed.end), caret: typed.start }
  }
  return null
}
