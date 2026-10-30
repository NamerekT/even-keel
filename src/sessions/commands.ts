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

/** A known command at the start of a message; `start` and `end` — where `/name` stands in the text. */
export interface TypedCommand {
  command: ChatCommand
  args: string
  start: number
  end: number
}

const HEAD = /^(\s*)\/(\S+)(?=\s|$)/

/** The command a message starts with, spaces before it allowed; `null` for anything else, an unknown name included. */
export function commandIn(text: string): TypedCommand | null {
  const match = HEAD.exec(text)
  if (match === null) return null
  const command = CHAT_COMMANDS.find((each) => each.name === match[2])
  if (command === undefined) return null
  const start = match[1]!.length
  const end = match[0].length
  return { command, args: text.slice(end).trim(), start, end }
}

/** The commands whose name holds what was typed after `/`. */
export function matchingCommands(typed: string): ChatCommand[] {
  const query = typed.toLowerCase()
  return CHAT_COMMANDS.filter((command) => command.name.includes(query))
}
