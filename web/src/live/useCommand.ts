import { useState } from 'react'
import { useLive } from './context.js'

export function useCommand() {
  const { command } = useLive()
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const send = async (name: string, body?: Record<string, unknown>) => {
    setSending(true)
    setFailure(null)
    try {
      await command(name, body)
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSending(false)
    }
  }

  return { send, sending, failure }
}
