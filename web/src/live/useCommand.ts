import { useEffect, useRef, useState } from 'react'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import { useLive } from './context.js'

// The button of the click being handled: `send` marks it busy, so every command button shows that the press was taken.
let pressed: HTMLButtonElement | null = null

if (typeof document !== 'undefined') {
  document.addEventListener(
    'click',
    (event) => {
      pressed = event.target instanceof Element ? event.target.closest('button') : null
      setTimeout(() => (pressed = null))
    },
    true,
  )
}

export function useCommand() {
  const { command, state } = useLive()
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<Notice | null>(null)

  const send = async (name: string, body?: Record<string, unknown>): Promise<boolean> => {
    const button = pressed
    button?.setAttribute('aria-busy', 'true')
    setSending(true)
    setFailure(null)
    try {
      await command(name, body)
      if ((name === 'settings' || name === 'project/settings') && typeof body?.provider === 'string' && body.provider !== '' &&
          body.provider !== (body.base as { provider?: string } | undefined)?.provider) {
        const copy = state?.cliCopies?.[body.provider]
        if (copy?.source === 'checked' && copy.status !== 'ready') window.dispatchEvent(new CustomEvent('even-keel:cli-consent', { detail: body.provider }))
      }
      if (name === 'settings' && body?.cli) {
        const before = (body.base as { cli?: Record<string, string> } | undefined)?.cli
        for (const [provider, source] of Object.entries(body.cli as Record<string, string>)) {
          if (source === 'checked' && before?.[provider] !== source && state?.cliCopies?.[provider]?.status !== 'ready') {
            window.dispatchEvent(new CustomEvent('even-keel:cli-consent', { detail: provider }))
          }
        }
      }
      return true
    } catch (reason) {
      setFailure(noticeOf(reason))
      return false
    } finally {
      button?.removeAttribute('aria-busy')
      setSending(false)
    }
  }

  return { send, sending, failure }
}

/** For a command the service answers at once and carries out later: on from `begin()` until `value` changes or the time runs out. */
export function useHold(value: string, limitMs: number): { on: boolean; begin: () => void } {
  const [held, setHeld] = useState<string | null>(null)

  useEffect(() => {
    if (held === null) return
    const timer = setTimeout(() => setHeld(null), limitMs)
    return () => clearTimeout(timer)
  }, [held, limitMs])

  return { on: held === value, begin: () => setHeld(value) }
}

interface Landing {
  value: string
  answered: boolean
  late: boolean
}

/**
 * For a command whose result only the next state shows, such as a settings save: `on` from `land`'s start, through the
 * answer, until `value` changes. Once `limitMs` passed after the answer with `value` the same, `late` instead, until it
 * changes or `land` runs again. A failed command lets go at once; the time the command takes is not counted.
 */
export function useLanding(value: string, limitMs: number): { on: boolean; late: boolean; land: (run: () => Promise<boolean>) => Promise<boolean> } {
  const [held, setHeld] = useState<Landing | null>(null)
  const latest = useRef(value)
  latest.current = value

  useEffect(() => {
    if (held !== null && held.value !== value) setHeld(null)
  }, [held, value])

  useEffect(() => {
    if (held === null || !held.answered || held.late) return
    const timer = setTimeout(() => setHeld({ ...held, late: true }), limitMs)
    return () => clearTimeout(timer)
  }, [held, limitMs])

  const land = async (run: () => Promise<boolean>) => {
    const from = value
    setHeld({ value: from, answered: false, late: false })
    const ok = await run()
    setHeld(ok && latest.current === from ? { value: from, answered: true, late: false } : null)
    return ok
  }
  const holds = held !== null && held.value === value
  return { on: holds && !held.late, late: holds && held.late, land }
}
