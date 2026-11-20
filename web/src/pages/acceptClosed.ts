import { useState } from 'react'
import type { FeedLine } from '../../../src/sessions/transcript.js'

/** Sessions whose "Accept as answer" banner was closed, each by the time of the last line of the turn it was closed on. */
export type AcceptClosed = Record<string, string>

interface Turn {
  sessionId: string
  feed: readonly Pick<FeedLine, 'at'>[]
}

const KEY = 'even-keel.chat.acceptClosed'
const KEEP = 200

export function parseAcceptClosed(text: string | null): AcceptClosed {
  try {
    const value: unknown = JSON.parse(text ?? '{}')
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    const entries = Object.entries(value)
    return entries.every(([, at]) => typeof at === 'string') ? Object.fromEntries(entries) as AcceptClosed : {}
  } catch {
    return {}
  }
}

export function isAcceptClosed(closed: AcceptClosed, turn: Turn): boolean {
  const at = turn.feed.at(-1)?.at
  return at !== undefined && closed[turn.sessionId] === at
}

/** One turn a session, the latest sessions only: the next turn of a session shows the banner again. */
export function closeAcceptTurn(closed: AcceptClosed, turn: Turn): AcceptClosed {
  const at = turn.feed.at(-1)?.at
  if (at === undefined) return closed
  const rest = Object.entries(closed).filter(([session]) => session !== turn.sessionId)
  return Object.fromEntries([...rest, [turn.sessionId, at]].slice(-KEEP))
}

/** Whether the banner is closed for the session's current turn, remembered in the browser, and the way to close it. */
export function useAcceptClosed(turn: Turn): [boolean, () => void] {
  const [closed, setClosed] = useState(read)
  const close = () => {
    const next = closeAcceptTurn(read(), turn)
    setClosed(next)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {}
  }
  return [isAcceptClosed(closed, turn), close]
}

function read(): AcceptClosed {
  try {
    return parseAcceptClosed(localStorage.getItem(KEY))
  } catch {
    return {}
  }
}
