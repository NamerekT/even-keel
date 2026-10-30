import { PROMPTS, type PromptTexts } from '../chain/prompts.js'
import { LANGUAGES, type Language } from '../language.js'
import { commandIn } from './commands.js'

type CommandText = (texts: PromptTexts) => (extra: string | null) => string

/** The prompt of each command of `CHAT_COMMANDS`, by name. */
const TEXTS: Record<string, CommandText> = {
  handoff: (texts) => texts.handoff,
}

const SPLIT = '\u0000'

/** A chat message as the session gets it: a command at its start expanded into its prompt, anything else as written. */
export function commandPrompt(text: string, language: Language): string {
  const typed = commandIn(text)
  const prompt = typed === null ? undefined : TEXTS[typed.command.name]
  if (typed === null || prompt === undefined) return text
  return prompt(PROMPTS[language])(typed.args === '' ? null : typed.args)
}

/** The other way: an expanded command, in either language, back to what the user typed, for the chat's feed. */
export function typedText(text: string): string {
  for (const [name, prompt] of Object.entries(TEXTS)) {
    for (const language of LANGUAGES) {
      const texts = PROMPTS[language]
      if (text === prompt(texts)(null)) return `/${name}`
      const [before, after] = prompt(texts)(SPLIT).split(SPLIT) as [string, string]
      if (text.length > before.length + after.length && text.startsWith(before) && text.endsWith(after)) {
        return `/${name} ${text.slice(before.length, text.length - after.length)}`
      }
    }
  }
  return text
}
