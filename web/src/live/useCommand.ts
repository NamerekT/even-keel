import { useEffect, useState } from 'react'
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
  const { command } = useLive()
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<Notice | null>(null)

  const send = async (name: string, body?: Record<string, unknown>): Promise<boolean> => {
    const button = pressed
    button?.setAttribute('aria-busy', 'true')
    setSending(true)
    setFailure(null)
    try {
      await command(name, body)
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
