import { useEffect, useRef, useState } from 'react'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'

export const POLL_MS = 1_500
/** The longest pause between reads while the service does not answer. */
export const POLL_MAX_MS = 15_000

export interface Polled<T> {
  /** The last state read or set; `null` until the first answer. */
  state: T | null
  /** An action's answer, taken as a read's. */
  set: (state: T) => void
  read: () => Promise<void>
  /** The last read failed: `retrying` — the work it follows goes on and the read is asked again; otherwise it stands as a refusal. */
  failure: { notice: Notice; retrying: boolean } | null
}

interface Settled {
  failures: number
  notice: Notice | null
}

/**
 * The state of work the service runs, read while it goes (BTN-1456): each answer asks for the next one `POLL_MS` later
 * while `going` holds of the last state, and so does a failed read, the pause doubling up to `POLL_MAX_MS` — one lost
 * answer (a proxy's 502 while the service's loop is busy) does not stop the window. The next answer clears the failure.
 * `key` — a new one reads at once.
 */
export function usePolledState<T>(ask: () => Promise<T>, going: (state: T | null) => boolean, key: unknown): Polled<T> {
  const [state, setState] = useState<T | null>(null)
  const [settled, setSettled] = useState<Settled>({ failures: 0, notice: null })
  const asked = useRef(ask)
  asked.current = ask
  const read = async () => {
    try {
      const answer = await asked.current()
      setState(answer)
      setSettled({ failures: 0, notice: null })
    } catch (reason) {
      setSettled((prior) => ({ failures: prior.failures + 1, notice: noticeOf(reason) }))
    }
  }
  useEffect(() => void read(), [key])
  const on = going(state)
  useEffect(() => {
    if (!on) return
    const timer = setTimeout(() => void read(), pauseOf(settled.failures))
    return () => clearTimeout(timer)
  }, [settled, on])
  const failure = settled.notice === null ? null : { notice: settled.notice, retrying: on }
  return { state, set: setState, read, failure }
}

/** The pause before the next read after `failures` failed ones in a row. */
export function pauseOf(failures: number): number {
  return Math.min(POLL_MS * 2 ** failures, POLL_MAX_MS)
}
