import type { ChatCard, ChatState } from '../../../src/chats/model.js'

/** The colour of a chat's agent icon (BTN-1231): blue at work, amber waiting for the user, green answered, grey cold, red stopped. */
export type ChatTone = 'working' | 'waiting' | 'answered' | 'idle' | 'error'

const TONES: Record<ChatState, ChatTone> = {
  new: 'idle',
  starting: 'working',
  working: 'working',
  waiting: 'waiting',
  answered: 'answered',
  cold: 'idle',
  error: 'error',
  archived: 'idle',
}

export function chatTone(state: ChatState): ChatTone {
  return TONES[state]
}

/** The Chats tab's badge: the chats waiting for the user in amber, else the unread answers in blue; `null` — none. */
export function chatsBadge(cards: readonly ChatCard[]): { count: number; tone: 'waiting' | 'unread' } | null {
  const waiting = cards.filter((card) => card.state === 'waiting').length
  if (waiting > 0) return { count: waiting, tone: 'waiting' }
  const unread = cards.filter((card) => card.unread).length
  return unread > 0 ? { count: unread, tone: 'unread' } : null
}

export type ChatChip = 'question' | 'working' | 'cold'

/** The chip at the right of a chat's title; `null` — the colour of its icon says enough. */
export function chatChip(state: ChatState): ChatChip | null {
  if (state === 'waiting') return 'question'
  if (state === 'working' || state === 'starting') return 'working'
  return state === 'cold' ? 'cold' : null
}

/** "sonnet-5-5 · medium": the model without its provider, then the effort; `fallback` names the agent's default model. */
export function modelText(model: string | null, effort: string | null, fallback: string): string {
  const name = model === null ? fallback : model.slice(model.lastIndexOf('/') + 1).replace(/^claude-/, '')
  return effort === null ? name : `${name} · ${effort}`
}

/** How full the chat's context is, in whole percent; `null` — no session, no window or nothing read yet. */
export function contextPercent(context: ChatCard['context']): number | null {
  if (context === null || context.window === null || context.window <= 0 || context.tokens <= 0) return null
  return Math.round((context.tokens / context.window) * 100)
}
