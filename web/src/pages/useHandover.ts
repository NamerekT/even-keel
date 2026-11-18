import { useEffect, useRef, useState } from 'react'
import type { Notice } from '../../../src/notice/notice.js'
import { BOOT_WAIT_MS } from '../../../src/sessions/boot.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import type { ChatHandover } from '../sessionStart.js'
import { useLoader, type LoaderPhase } from '../ui/loaderPhase.js'
import { LOCAL_WAIT_MS, shownHandover, type HeldHandover, type LocalHandover } from './chatHandover.js'

export interface HandoverView {
  /** The handover the window shows instead of its feed (`shownHandover`). */
  shown: ChatHandover | null
  /** Its loader's phase; the feed waits for `done`. */
  phase: LoaderPhase
  /** What the loader shows, the last handover shown while it leaves. */
  last: ChatHandover | null
  /** The error of the handover that failed. */
  error: Notice | null
  /** The message of a failed handover for the empty field, once per key. */
  restore: { key: string; text: string } | null
  /** The press of "New session with this message": gives what takes it back. */
  press: (message: string) => () => void
}

/** The chat window's handover (BTN-1281): the press, what the service reports, and the wait for the new session's feed. */
export function useHandover(server: ChatHandover | null, sessionId: string, lines: FeedLine[] | null | undefined): HandoverView {
  const [local, setLocal] = useState<LocalHandover | null>(null)
  const [held, setHeld] = useState<HeldHandover | null>(null)
  const [restore, setRestore] = useState<{ key: string; text: string } | null>(null)
  const failed = server?.error === undefined ? null : server

  if (failed !== null) {
    if (restore?.key !== failed.since) setRestore({ key: failed.since, text: failed.message ?? held?.message ?? local?.message ?? '' })
    if (local !== null) setLocal(null)
    if (held !== null) setHeld(null)
  } else if (server !== null) {
    const next = { ...server, message: server.message ?? held?.message ?? local?.message ?? null }
    const same = held !== null && held.released === undefined && held.phase === next.phase && held.since === next.since
    if (!same || held.sessionId !== next.sessionId || held.message !== next.message) setHeld(next)
    if (local !== null) setLocal(null)
  } else if (held !== null && held.released === undefined) {
    setHeld({ ...held, released: Date.now() })
  }

  const shown = shownHandover({ server, local, held, sessionId, lines, now: Date.now() })
  if (shown === null && server === null && held !== null) setHeld(null)

  // A press the service never took up and a held handover whose session never showed end on their own.
  useEffect(() => {
    if (local === null) return
    const timer = setTimeout(() => {
      setLocal(null)
      setRestore({ key: local.since, text: local.message })
    }, LOCAL_WAIT_MS)
    return () => clearTimeout(timer)
  }, [local])
  useEffect(() => {
    if (held === null) return
    const end = Math.min(Date.parse(held.since) + BOOT_WAIT_MS, held.released === undefined ? Infinity : held.released + LOCAL_WAIT_MS)
    const timer = setTimeout(() => setHeld(null), Math.max(0, end - Date.now()))
    return () => clearTimeout(timer)
  }, [held])

  const phase = useLoader(shown !== null)
  const last = useRef<ChatHandover | null>(null)
  if (shown !== null) last.current = shown

  const press = (message: string) => {
    const pressed = { since: new Date().toISOString(), message, from: sessionId }
    setLocal(pressed)
    return () => setLocal((now) => (now === pressed ? null : now))
  }
  return { shown, phase, last: last.current, error: failed?.error ?? null, restore, press }
}
