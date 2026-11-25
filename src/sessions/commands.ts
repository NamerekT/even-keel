import type { Language } from '../language.js'

/** A command of the chat window (BTN-557): typed at the start of a message, expanded by the service into a prompt. */
export interface ChatCommand {
  name: string
  description: Record<Language, string>
  /** What may follow the command, shown muted after it in the field. */
  args: Record<Language, string>
}

/** Every command the chat knows; a new one is an entry here and its prompt in `commandPrompt.ts`. */
export const CHAT_COMMANDS: readonly ChatCommand[] = [
  {
    name: 'handoff',
    description: {
      en: 'Hand the task over to a fresh session with a note',
      ru: 'Передать задачу новой сессии с запиской',
    },
    args: { en: '[what to keep in mind]', ru: '[что учесть]' },
  },
]

/**
 * An entry of the chat's `/` menu that the session expands itself (BTN-1695, `docs/web/session-panel/turn.md`): a command or
 * skill of the user's configuration copy, or a skill of the project's package plugin as `<plugin>:<skill>`. It goes to
 * the session as typed.
 */
export interface MenuEntry {
  name: string
  kind: 'command' | 'skill'
  from: 'user' | 'package'
  description: string
  /** `argument-hint` of its frontmatter; empty — none. */
  args: string
}

/** A known command at the start of a message; `start` and `end` — where `/name` stands in the text. */
export interface TypedCommand {
  command: ChatCommand
  args: string
  start: number
  end: number
}

const HEAD = /^(\s*)\/(\S+)(?=\s|$)/

/** The `/name` a message starts with, spaces before it allowed, whatever the name; `null` — no slash at its start. */
export function headOf(text: string): { name: string; args: string; start: number; end: number } | null {
  const match = HEAD.exec(text)
  if (match === null) return null
  const start = match[1]!.length
  const end = match[0].length
  return { name: match[2]!, args: text.slice(end).trim(), start, end }
}

/** The command a message starts with, spaces before it allowed; `null` for anything else, an unknown name included. */
export function commandIn(text: string): TypedCommand | null {
  const head = headOf(text)
  const command = head === null ? undefined : CHAT_COMMANDS.find((each) => each.name === head.name)
  if (head === null || command === undefined) return null
  return { command, args: head.args, start: head.start, end: head.end }
}
