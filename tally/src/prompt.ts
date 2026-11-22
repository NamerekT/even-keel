import type { Entry } from '../../src/sessions/entry.js'
import { expandPromptFile } from '../../src/sessions/prompt-file.js'
import { isContextBlock, isPrompt, promptOf } from '../../src/sessions/transcript.js'

const COMMAND = /^<(?:command-|local-command-)/
const PROMPT_LIMIT = 2000

/** The first human prompt of the main thread among a session's rows in order; slash commands and their output are not prompts. */
export function firstPrompt(entries: Iterable<Entry>, limit = PROMPT_LIMIT): string | null {
  for (const entry of entries) {
    if (entry.type !== 'user' || entry.isMeta === true || entry.agentId !== undefined) continue
    if (entry.origin?.kind !== undefined && entry.origin.kind !== 'human') continue
    if (!isPrompt(entry.message?.content)) continue
    const text = expandPromptFile(promptOf(entry.message?.content), entry.cwd).trim()
    if (text === '' || COMMAND.test(text) || isContextBlock(text)) continue
    return text.slice(0, limit)
  }
  return null
}
