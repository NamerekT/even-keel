import { PROMPTS, type PromptTexts } from '../chain/prompts.js'
import { LANGUAGES, type Language } from '../language.js'
import { commandIn } from './commands.js'
import { HANDOFF_NOTE } from './note.js'

/** `note` — the handoff note of the session's task (`noteFileOf`). */
type CommandText = (texts: PromptTexts) => (extra: string | null, note: string) => string

/** The prompt of each command of `CHAT_COMMANDS`, by name. */
const TEXTS: Record<string, CommandText> = {
  handoff: (texts) => texts.handoff,
}

const SPLIT = '\u0000'
/** A note an expanded command may name: the shared one or a task's own. */
const NOTE = /\.temp\/handoff(?:-[A-Za-z0-9._-]+)?\.md/

/**
 * A chat message as the session gets it: a command at its start expanded into its prompt, anything else as written.
 * `note` — the handoff note of the task the message goes to (BTN-964).
 */
export function commandPrompt(text: string, language: Language, note = HANDOFF_NOTE): string {
  const typed = commandIn(text)
  const prompt = typed === null ? undefined : TEXTS[typed.command.name]
  if (typed === null || prompt === undefined) return text
  return prompt(PROMPTS[language])(typed.args === '' ? null : typed.args, note)
}

/** The other way: an expanded command, in either language and with any task's note, back to what the user typed, for the chat's feed. */
export function typedText(text: string): string {
  const note = NOTE.exec(text)?.[0] ?? HANDOFF_NOTE
  for (const [name, prompt] of Object.entries(TEXTS)) {
    for (const language of LANGUAGES) {
      const texts = PROMPTS[language]
      if (text === prompt(texts)(null, note)) return `/${name}`
      const [before, after] = prompt(texts)(SPLIT, note).split(SPLIT) as [string, string]
      if (text.length > before.length + after.length && text.startsWith(before) && text.endsWith(after)) {
        return `/${name} ${text.slice(before.length, text.length - after.length)}`
      }
    }
  }
  return text
}
