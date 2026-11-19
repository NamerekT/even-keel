import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatCard, ChatChoice } from '../../../src/chats/model.js'
import { useLive } from '../live/context.js'

/** Chats are not in the live state: the project page asks for them this often (BTN-1231). */
const POLL_MS = 4_000

export interface ProjectChatsView {
  /** `null` — not read yet. */
  chats: ChatCard[] | null
  /** The project's last choice of a new chat. */
  choice: ChatChoice | null
  failed: boolean
  refresh: () => void
}

/** The project's active chats, read every few seconds while the page is open: for the Chats tab's badge and its list. */
export function useProjectChats(project: string): ProjectChatsView {
  // `useLive` gives new functions each render: the poll keeps the latest without restarting.
  const { read } = useLive()
  const live = useRef(read)
  live.current = read
  const [chats, setChats] = useState<ChatCard[] | null>(null)
  const [choice, setChoice] = useState<ChatChoice | null>(null)
  const [failed, setFailed] = useState(false)
  const again = useRef<() => void>(() => {})

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    setChats(null)
    const load = async () => {
      clearTimeout(timer)
      try {
        const found = await live.current<{ chats: ChatCard[]; choice: ChatChoice | null }>('chats/list', { project })
        if (!alive) return
        setChats(found.chats)
        setChoice(found.choice)
        setFailed(false)
      } catch {
        if (alive) setFailed(true)
      }
      if (alive) timer = setTimeout(() => void load(), POLL_MS)
    }
    again.current = () => void load()
    void load()
    return () => {
      alive = false
      clearTimeout(timer)
      again.current = () => {}
    }
  }, [project])

  const refresh = useCallback(() => again.current(), [])
  return { chats, choice, failed, refresh }
}
