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

function lastHead(prompt: string): { head: string; at: number } | undefined {
  const found = HEADS.map((head) => ({ head, at: prompt.lastIndexOf(`\n${head}\n\n`) })).filter((each) => each.at >= 0)
  return found.sort((a, b) => b.at - a.at)[0]
}

/** The first prompt of a session started by a `message` handover, split into the handoff and the user's message after it. */
export function splitUserMessage(prompt: string): { handoff: string; message: string } | null {
  const last = lastHead(prompt)
  if (last === undefined) return null
  const message = prompt.slice(last.at + last.head.length + 3).trim()
  return message === '' ? null : { handoff: prompt.slice(0, last.at).trimEnd(), message }
}

/**
 * A `message` handover cut before its user's message: `rest` as it stood before the line the message's head starts,
 * `tail` the head with the message, put back at the very end once the brief and the settings' texts are on (BTN-1423).
 */
export function cutUserMessage(prompt: string): { rest: string; tail: string } | null {
  if (splitUserMessage(prompt) === null) return null
  const { at } = lastHead(prompt)!
  return { rest: prompt.slice(0, at), tail: prompt.slice(at + 1) }
}
