import { useState } from 'react'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import { useLive } from './context.js'

export function useCommand() {
  const { command } = useLive()
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<Notice | null>(null)

  const send = async (name: string, body?: Record<string, unknown>): Promise<boolean> => {
    setSending(true)
    setFailure(null)
    try {
      await command(name, body)
      return true
    } catch (reason) {
      setFailure(noticeOf(reason))
      return false
    } finally {
      setSending(false)
    }
  }

  return { send, sending, failure }
}
