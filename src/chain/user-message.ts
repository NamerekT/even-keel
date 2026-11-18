import type { Language } from '../language.js'

/**
 * The head of the user's chat message a `message` handover ends with (BTN-757). The page reads it too (BTN-1281), to
 * show the message apart from the handoff prompt, so this module imports nothing that runs.
 */
export const USER_MESSAGE_HEAD: Record<Language, string> = {
  en: 'The user\'s message:',
  ru: 'Сообщение пользователя:',
}

const HEADS = Object.values(USER_MESSAGE_HEAD)

/** `current.reply` of a `message` move, `<head>\n\n<message>`, as the user wrote it; `null` — no such reply. */
export function userMessageOf(reply: string | undefined): string | null {
  if (reply === undefined) return null
  const head = HEADS.find((each) => reply.startsWith(`${each}\n\n`))
  return head === undefined ? null : reply.slice(head.length + 2).trim()
}

/** The first prompt of a session started by a `message` handover, split into the handoff and the user's message after it. */
export function splitUserMessage(prompt: string): { handoff: string; message: string } | null {
  const found = HEADS.map((head) => ({ head, at: prompt.lastIndexOf(`\n${head}\n\n`) })).filter((each) => each.at >= 0)
  const last = found.sort((a, b) => b.at - a.at)[0]
  if (last === undefined) return null
  const message = prompt.slice(last.at + last.head.length + 3).trim()
  return message === '' ? null : { handoff: prompt.slice(0, last.at).trimEnd(), message }
}
