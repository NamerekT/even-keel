import { useEffect, useState } from 'react'
import type { AccountEntry } from '../../../src/account/model.js'
import type { ChatCard, ChatMachines } from '../../../src/chats/model.js'
import { useLive } from '../live/context.js'
import { chatAccounts } from './chatMachines.js'

/**
 * The accounts of the chat's machine (BTN-1614): whose limits tell whether a message goes on in a new session, and
 * which that session may take. A machine elsewhere's are asked for (`chats/machines`) when the window opens and again
 * each time `renewing` changes, so the renewal window sees fresh limits; `undefined` until they come.
 */
export function useChatAccounts(chat: ChatCard, renewing: boolean): AccountEntry[] | undefined {
  const { state, query } = useLive()
  const [answer, setAnswer] = useState<ChatMachines | null>(null)
  const elsewhere = chat.machine !== undefined && chat.machine !== state?.ownMachine
  useEffect(() => {
    if (!elsewhere) return
    let live = true
    query<ChatMachines>('chats/machines', { project: chat.project }).then(
      (next) => {
        if (live) setAnswer(next)
      },
      () => {
        if (live) setAnswer({ machines: [], picked: null })
      },
    )
    return () => {
      live = false
    }
  }, [renewing, elsewhere, chat.project])
  return chatAccounts(answer, chat.machine, state?.ownMachine, state?.account)
}
