import type { ChatCard } from '../../../src/chats/model.js'
import { t } from '../i18n/index.js'
import { MoreMenu, type MoreItem } from '../ui/MoreMenu.js'
import { chatActions, type ChatAction } from './projectChats.js'

interface Props {
  chat: ChatCard
  className?: string
  onAct: (chat: ChatCard, action: ChatAction) => void
}

/**
 * The quiet ⋯ of a project chat (BTN-1775), one list for its card and its window's head. Both actions cannot be undone,
 * so their lines are red (`docs/design.md`, "Buttons"); a first session still launching cannot be archived yet.
 */
export function ChatMenu({ chat, className, onAct }: Props) {
  const items: MoreItem[] = chatActions(chat).map((action) => ({
    label: t.chats.menu[action],
    danger: true,
    ...(action === 'archive' && chat.state === 'starting' && chat.sessionId === null && { problem: t.chats.window.starting }),
    pick: () => onAct(chat, action),
  }))
  return <MoreMenu items={items} label={t.chats.menu.label} quiet className={className} />
}
