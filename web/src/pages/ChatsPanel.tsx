import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { ChatCard, ChatPage } from '../../../src/chats/model.js'
import { agentLabel } from '../accountName.js'
import { formatStamp } from '../format.js'
import { t } from '../i18n/index.js'
import { AgentIcon } from '../layout/accountParts.js'
import { useNarrow } from '../layout/useNarrow.js'
import { useNow } from '../layout/useNow.js'
import { useLive } from '../live/context.js'
import { AccountTag } from '../ui/AccountTag.js'
import { EmptyState } from '../ui/blocks.js'
import { ChatIcon, PlusIcon, SearchIcon } from '../ui/icons.js'
import { SEG_CLASS, type ChipLook } from './chipLook.js'
import { NewChatDialog } from './NewChatDialog.js'
import { chatChip, chatsBadge, chatTone, contextPercent, modelText } from './projectChats.js'
import { GroupTabs } from './settingsParts.js'
import type { ProjectChatsView } from './useProjectChats.js'
import './chats.css'

const ProjectChatWindow = lazy(async () => ({ default: (await import('./ProjectChatWindow.js')).ProjectChatWindow }))

/** The address hash that opens the chats panel; a task id never equals it. */
export const CHATS_HASH = 'chats'

const CHIP_CLASS: Record<ChipLook, string> = { tag: 'tag tag--chats', tab: 'side-tab side-tab--wide', seg: SEG_CLASS }
const SEARCH_MS = 300

/** The Chats tab: amber with the chats waiting for the user, else blue with the unread answers. */
export function ChatsChip({ chats, open, look = 'tag', onToggle }: { chats: ChatCard[] | null; open: boolean; look?: ChipLook; onToggle: () => void }) {
  const badge = chats === null ? null : chatsBadge(chats)
  const seg = look === 'seg'
  const tip = badge === null ? t.chats.tabTip : badge.tone === 'waiting' ? t.chats.waitingTip(badge.count) : t.chats.unreadTip(badge.count)
  return (
    <button type="button" className={CHIP_CLASS[look]} aria-expanded={open} aria-label={seg ? t.chats.tab : undefined} title={tip} onClick={onToggle}>
      <ChatIcon />
      {!seg && t.chats.tab}
      {badge !== null && <span className={`chats-badge chats-badge--${badge.tone}`}>{badge.count}</span>}
    </button>
  )
}

type Section = 'active' | 'archive'

interface Props {
  project: string
  chats: ProjectChatsView
  onClose: () => void
}

/** The project's chats (BTN-1231): the active ones as cards, the archive by pages, a new session from the corner. */
export function ChatsPanel({ project, chats, onClose }: Props) {
  const [section, setSection] = useState<Section>('active')
  const [opened, setOpened] = useState<ChatCard | null>(null)
  const [creating, setCreating] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => closeRef.current?.focus({ preventScroll: true }), [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.querySelector('dialog[open]') === null) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // The open chat follows the list: its state, its title and its session as they come.
  const shown = opened === null ? null : (chats.chats?.find((chat) => chat.id === opened.id) ?? opened)
  const active = chats.chats ?? []
  const groups = [
    { id: 'active' as const, title: `${t.chats.active} · ${active.length}` },
    { id: 'archive' as const, title: t.chats.archive },
  ]

  return (
    <aside className="panel chats" aria-label={t.chats.sections}>
      <header className="panel__head chats__head">
        <GroupTabs groups={groups} open={section} dirty={() => false} onOpen={setSection} label={t.chats.sections} />
        <button ref={closeRef} type="button" className="panel__close" aria-label={t.session.closePanel} onClick={onClose}>
          ×
        </button>
      </header>
      {section === 'active' ? (
        <ActiveList chats={chats} onOpen={setOpened} onNew={() => setCreating(true)} />
      ) : (
        <ArchiveList project={project} active={active} onOpen={setOpened} />
      )}
      {section === 'active' && active.length > 0 && (
        <button type="button" className="button button--primary chats__new" onClick={() => setCreating(true)}>
          <PlusIcon />
          {t.chats.newSession}
        </button>
      )}
      {creating && (
        <NewChatDialog
          project={project}
          choice={chats.choice}
          onClose={() => setCreating(false)}
          onStarted={(chat) => {
            setCreating(false)
            setSection('active')
            setOpened(chat)
            chats.refresh()
          }}
        />
      )}
      {shown !== null && (
        <Suspense fallback={null}>
          <ProjectChatWindow
            key={shown.id}
            chat={shown}
            onClose={() => {
              setOpened(null)
              chats.refresh()
            }}
            onContinue={() => {
              setOpened(null)
              setCreating(true)
            }}
            onChanged={chats.refresh}
          />
        </Suspense>
      )}
    </aside>
  )
}

function ActiveList({ chats, onOpen, onNew }: { chats: ProjectChatsView; onOpen: (chat: ChatCard) => void; onNew: () => void }) {
  const now = useNow(30_000)
  const narrow = useNarrow()
  if (chats.chats === null) return chats.failed ? <p className="notice notice--error">{t.chats.failed}</p> : null
  if (chats.chats.length === 0) {
    return (
      <EmptyState
        className="chats__empty"
        action={
          <button type="button" className="button button--primary" onClick={onNew}>
            <PlusIcon />
            {t.chats.newSession}
          </button>
        }
      >
        {t.chats.empty}
      </EmptyState>
    )
  }
  return (
    <ul className="chats__list">
      {chats.chats.map((chat) => (
        <li key={chat.id}>
          <ChatCardButton chat={chat} now={now} narrow={narrow} onOpen={() => onOpen(chat)} />
        </li>
      ))}
    </ul>
  )
}

function ChatCardButton({ chat, now, narrow, onOpen }: { chat: ChatCard; now: Date; narrow: boolean; onOpen: () => void }) {
  const tone = chatTone(chat.state)
  const chip = chatChip(chat.state)
  const percent = contextPercent(chat.context)
  return (
    <button type="button" className="chat-card" onClick={onOpen}>
      <span className={`chat-card__icon chats-tone--${tone}`} role="img" aria-label={t.chats.tones[tone]} title={t.chats.tones[tone]}>
        <AgentIcon agent={chat.agent} />
      </span>
      <span className="chat-card__title">
        <span className="chat-card__text">{chat.title ?? t.chats.untitled}</span>
        {chat.unread && <span className="chat-card__unread" role="img" aria-label={t.chats.unread} title={t.chats.unread} />}
      </span>
      <span className="chat-card__when">
        {chip !== null && <span className={`chip chat-card__chip chat-card__chip--${chip}`}>{(narrow ? t.chats.chipsShort : t.chats.chips)[chip]}</span>}
        <time dateTime={chat.lastAt}>{formatStamp(chat.lastAt, now)}</time>
      </span>
      <span className="chat-card__meta">
        <AccountTag account={chat.account} agent={chat.agent} />
        <span className="tag">{modelText(chat.model, chat.effort, t.chats.defaultModel)}</span>
        {percent !== null && <span title={t.chats.contextTip}>{t.chats.context(percent)}</span>}
      </span>
      {chat.last !== null && (
        <span className="chat-card__last">
          <span className="chat-card__said">
            <b>{chat.last.from === 'user' ? t.chats.you : chat.last.from === 'ask' ? t.chats.asks : agentLabel(chat.agent)}:</b> {chat.last.text}
          </span>
        </span>
      )}
    </button>
  )
}

function ArchiveList({ project, active, onOpen }: { project: string; active: ChatCard[]; onOpen: (chat: ChatCard) => void }) {
  const { read } = useLive()
  const now = useNow(60_000)
  const [words, setWords] = useState('')
  const [asked, setAsked] = useState('')
  const [page, setPage] = useState(0)
  const [found, setFound] = useState<ChatPage | null>(null)
  const [failed, setFailed] = useState(false)
  const reader = useRef(read)
  reader.current = read

  useEffect(() => {
    const timer = setTimeout(() => {
      setAsked(words.trim())
      setPage(0)
    }, SEARCH_MS)
    return () => clearTimeout(timer)
  }, [words])

  useEffect(() => {
    let alive = true
    reader.current<ChatPage>('chats/archive', { project, words: asked, page }).then(
      (answer) => {
        if (!alive) return
        setFound(answer)
        setFailed(false)
      },
      () => alive && setFailed(true),
    )
    return () => {
      alive = false
    }
  }, [project, asked, page])

  const titleOf = (id: string) => [...active, ...(found?.chats ?? [])].find((chat) => chat.id === id)?.title ?? null
  return (
    <>
      <label className="chats__search">
        <SearchIcon />
        <input type="search" value={words} placeholder={t.chats.search} aria-label={t.chats.search} onChange={(event) => setWords(event.target.value)} />
      </label>
      {failed && <p className="notice notice--error">{t.chats.failed}</p>}
      {found !== null && found.chats.length === 0 && <p className="placeholder">{asked === '' ? t.chats.archiveEmpty : t.chats.nothing}</p>}
      {found !== null && found.chats.length > 0 && (
        <ul className="chats__list chats__list--archive">
          {found.chats.map((chat) => (
            <li key={chat.id}>
              <button type="button" className="chat-row" onClick={() => onOpen(chat)}>
                <span className="chat-row__icon">
                  <AgentIcon agent={chat.agent} />
                </span>
                <span className="chat-row__title">{chat.title ?? t.chats.untitled}</span>
                <time className="chat-row__date" dateTime={chat.archivedAt ?? chat.lastAt}>
                  {formatStamp(chat.lastAt, now)}
                </time>
                {chat.successor !== null ? (
                  <span className="chat-row__last chat-row__last--next">→ {titleOf(chat.successor) ?? t.chats.successor}</span>
                ) : (
                  chat.last !== null && <span className="chat-row__last">{chat.last.text}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {found !== null && (page > 0 || found.more) && (
        <nav className="chats__pager" aria-label={t.chats.archive}>
          <span>{t.chats.page(page + 1)}</span>
          <span className="chats__pages">
            <button type="button" className="button button--small" aria-label={t.chats.newer} title={t.chats.newer} disabled={page === 0} onClick={() => setPage(page - 1)}>
              ‹
            </button>
            <button type="button" className="button button--small" aria-label={t.chats.older} title={t.chats.older} disabled={!found.more} onClick={() => setPage(page + 1)}>
              ›
            </button>
          </span>
        </nav>
      )}
    </>
  )
}
