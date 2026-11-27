import { useState } from 'react'
import type { ChatCard, ChatChoice } from '../../../src/chats/model.js'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import { useLive } from '../live/context.js'
import { ChatRenewDialog } from './ChatRenewDialog.js'
import { useChatAccounts } from './useChatAccounts.js'

interface Props {
  chat: ChatCard
  /** The chat that goes on from this one, the old one archived with it as its successor. */
  onContinued: (next: ChatCard) => void
  onClose: () => void
}

/**
 * "Continue in new session…" of a chat's ⋯ menu (BTN-1776): the renewal window without a message, offering first what
 * the chat runs on. The new chat starts its session with the user's first message (`chats/continue`).
 */
export function ChatContinueDialog({ chat, onContinued, onClose }: Props) {
  const { query } = useLive()
  const accounts = useChatAccounts(chat, true)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Notice | undefined>(undefined)
  if (accounts === undefined) return null
  const own: ChatChoice = { account: chat.account, model: chat.model, effort: chat.effort, ...(chat.machine !== undefined && { machine: chat.machine }) }

  const go = async (picked: ChatChoice) => {
    setBusy(true)
    setFailure(undefined)
    try {
      onContinued(await query<ChatCard>('chats/continue', { id: chat.id, ...picked }))
    } catch (reason) {
      setFailure(noticeOf(reason))
      setBusy(false)
    }
  }

  return <ChatRenewDialog chat={chat} accounts={accounts} choice={own} busy={busy} failure={failure} onRenew={go} onClose={onClose} />
}
