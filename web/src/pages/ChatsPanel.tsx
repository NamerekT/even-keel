import { lazy, startTransition, Suspense, useEffect, useRef, useState } from 'react'
import type { ChatCard, ChatPage } from '../../../src/chats/model.js'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import { agentLabel } from '../accountName.js'
import { formatStamp } from '../format.js'
import { say, t } from '../i18n/index.js'
import { AgentIcon } from '../layout/accountParts.js'
import { useNarrow } from '../layout/useNarrow.js'
import { useNow } from '../layout/useNow.js'
import { useLive } from '../live/context.js'
import type { TaskMachine } from '../lanes.js'
import { AccountTag } from '../ui/AccountTag.js'
import { EmptyState } from '../ui/blocks.js'
import { ChatIcon, CloseIcon, PlusIcon, SearchIcon } from '../ui/icons.js'
import { MachineTag } from '../ui/MachineTag.js'
import { EffortBars } from '../ui/RunLabelTag.js'
import { SEG_CLASS, type ChipLook } from './chipLook.js'
import { NewChatDialog } from './NewChatDialog.js'
import { modelTip, shortModel } from '../ui/modelLabel.js'
import { ChatContinueDialog } from './ChatContinueDialog.js'
import { ChatMenu } from './ChatMenu.js'
import { chatChip, chatsBadge, chatTone, contextPercent, modelText, type ChatAction } from './projectChats.js'
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
      {badge !== null && <span className={`count-badge chats-badge--${badge.tone}`}>{badge.count}</span>}
    </button>
  )
}

type Section = 'active' | 'archive'

/** The Active tab's title: the word and the count as a badge. */
export function ActiveTab({ count }: { count: number }) {
  return (
    <>
      {t.chats.active}
      <span className="count-badge">{count}</span>
    </>
  )
}

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
  const { command } = useLive()
  // The cards on their way out (BTN-1775): they slide and fade until the list read again drops them.
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set())
  const [failure, setFailure] = useState<Notice | null>(null)
  const [continuing, setContinuing] = useState<ChatCard | null>(null)
  const act = (chat: ChatCard, action: ChatAction) => {
    if (action === 'continue') {
      setContinuing(chat)
      return
    }
    setOpened((now) => (now?.id === chat.id ? null : now))
    setFailure(null)
    setLeaving((now) => new Set(now).add(chat.id))
    command(action === 'archive' ? 'chats/hide' : 'chats/delete', { id: chat.id }).then(chats.refresh, (reason: unknown) => {
      setLeaving((now) => new Set([...now].filter((id) => id !== chat.id)))
      setFailure(noticeOf(reason))
    })
  }
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
    { id: 'active' as const, title: <ActiveTab count={active.length} /> },
    { id: 'archive' as const, title: t.chats.archive },
  ]

  return (
    <aside className="panel chats" aria-label={t.chats.sections}>
      <header className="panel__head chats__head">
        <GroupTabs groups={groups} open={section} dirty={() => false} onOpen={setSection} label={t.chats.sections} />
        <button ref={closeRef} type="button" className="panel__close" aria-label={t.session.closePanel} onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      {failure !== null && (
        <p className="notice notice--error" role="alert">
          {say(failure)}
        </p>
      )}
      {section === 'active' ? (
        <ActiveList project={project} chats={chats} leaving={leaving} onOpen={setOpened} onAct={act} />
      ) : (
        <ArchiveList project={project} active={active} onOpen={setOpened} />
      )}
      {section === 'active' && (
        <button type="button" className="button button--primary chats__new" onClick={() => setCreating(true)}>
          <PlusIcon />
          {t.chats.newSession}
        </button>
      )}
      <Suspense fallback={null}>
        {creating && (
          <NewChatDialog
            project={project}
            choice={chats.choice}
            onClose={() => setCreating(false)}
            onStarted={(chat) => {
              startTransition(() => {
                setCreating(false)
                setSection('active')
                setOpened(chat)
              })
              chats.refresh()
            }}
          />
        )}
        {shown !== null && (
          <ProjectChatWindow
            key={shown.id}
            chat={shown}
            choice={chats.choice}
            onOpen={(chat) => {
              setSection(chat.archivedAt === null ? 'active' : 'archive')
              setOpened(chat)
              chats.refresh()
            }}
            onClose={() => {
              setOpened(null)
              chats.refresh()
            }}
            onContinue={() => {
              setOpened(null)
              setCreating(true)
            }}
            onChanged={chats.refresh}
            onAct={act}
          />
        )}
        {continuing !== null && (
          <ChatContinueDialog
            chat={continuing}
            onClose={() => setContinuing(null)}
            onContinued={(next) => {
              const old = continuing.id
              setContinuing(null)
              setLeaving((now) => new Set(now).add(old))
              setOpened((now) => (now?.id === old ? next : now))
              chats.refresh()
            }}
          />
        )}
      </Suspense>
    </aside>
  )
}

interface ActiveProps {
  project: string
  chats: ProjectChatsView
  leaving: ReadonlySet<string>
  onOpen: (chat: ChatCard) => void
  onAct: (chat: ChatCard, action: ChatAction) => void
}

function ActiveList({ project, chats, leaving, onOpen, onAct }: ActiveProps) {
  const now = useNow(30_000)
  const narrow = useNarrow()
  const { state } = useLive()
  // The machine shows only when the project has a choice of them (BTN-1614): one machine says nothing.
  const several = (state?.pools?.[project]?.length ?? 0) > 1
  const machineOf = (chat: ChatCard): TaskMachine | null =>
    several && chat.machine !== undefined ? { id: chat.machine, name: state?.machineNames?.[chat.machine] ?? chat.machine, color: state?.machineColors?.[chat.machine] } : null
  if (chats.chats === null) return chats.failed ? <p className="notice notice--error">{t.chats.failed}</p> : null
  if (chats.chats.length === 0) return <EmptyState className="chats__empty">{t.chats.empty}</EmptyState>
  return (
    <ul className="chats__list">
      {chats.chats.map((chat) => (
        // The ⋯ stands beside the card's button, over its corner: a button holds no other button.
        <li key={chat.id} className={leaving.has(chat.id) ? 'chats__item chats__item--leaving' : 'chats__item'} inert={leaving.has(chat.id) || undefined}>
          <ChatCardButton chat={chat} machine={machineOf(chat)} now={now} narrow={narrow} onOpen={() => onOpen(chat)} />
          <ChatMenu chat={chat} className="chat-card__more" onAct={onAct} />
        </li>
      ))}
    </ul>
  )
}

/** The model tag's tip: the model's full name and id, its effort; `null` — the default model with no effort. */
function modelTagTip(chat: ChatCard): string | null {
  const lines = [chat.model === null ? null : modelTip(chat.model, chat.modelTitle), chat.effort === null ? null : `${t.chats.dialog.effort}: ${chat.effort}`]
  const told = lines.filter((line) => line !== null)
  return told.length === 0 ? null : told.join('\n')
}

function ChatCardButton({ chat, machine, now, narrow, onOpen }: { chat: ChatCard; machine: TaskMachine | null; now: Date; narrow: boolean; onOpen: () => void }) {
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
        {machine !== null && <MachineTag machines={[machine]} title={t.chats.machineTip(machine.name)} />}
        <AccountTag account={chat.account} agent={chat.agent} muted={tone === 'idle'} />
        <span className="tag" title={modelTagTip(chat) ?? undefined}>
          {modelText(chat.model, t.chats.defaultModel, chat.modelTitle)}
          <EffortBars effort={chat.effort} spaced className="chat-card__effort" />
        </span>
        {chat.model !== null && shortModel(chat.model).free && <span className="tag" title={t.session.modelFreeTip}>{t.session.modelFree}</span>}
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
