import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Ask, AskAnswers } from '../../../src/sessions/ask.js'
import type { FeedLine, Turn } from '../../../src/sessions/transcript.js'
import type { ContextScale, SessionView } from '../../../src/state.js'
import { formatElapsed, formatTokens } from '../format.js'
import { localized, t } from '../i18n/index.js'
import { useNow } from '../layout/useNow.js'
import { useLive } from '../live/context.js'
import { contextFill } from '../state.js'
import { AccountTag } from '../ui/AccountTag.js'
import { ContextMeter } from '../ui/ContextMeter.js'
import { Tipped } from '../ui/Tipped.js'
import { AnswerCard, AskCard } from './AskPanel.js'
import { ChatComposer } from './ChatComposer.js'
import { fileName } from './feedLine.js'
import { MediaViewer } from './MediaViewer.js'
import { Thumb, Thumbs } from './Thumbs.js'
import { EditSize, ToolGroup } from './ToolCalls.js'
import { editTotals, feedEntries, type EditTotal } from './toolGroups.js'
import { transcriptMedia, type TranscriptMedia } from './transcriptMedia.js'
import '../ui/markdown.css'
import './transcript.css'

const LINE_TIME = localized((language) => new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }))
const FULL_TIME = localized((language) => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'medium' }))
const POLL_MS = 3_000
const TICK_MS = 1_000
const PINNED_SLACK = 24
/** A user's message longer than this is folded, like the task prompt a session starts with. */
const FOLD_LINES = 8
const FOLD_CHARS = 600

const MARKDOWN: Components = {
  a: ({ href, children }) =>
    href !== undefined && /^(https?|mailto):/i.test(href) ? (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ alt }) => (alt ? <span className="markdown__image">[{alt}]</span> : null),
}

/** The current session of a chain task: the window becomes a chat that answers it. */
export interface ChatTarget {
  project: string
  task: string
  session: SessionView
  /** The task made way for the fix of a red main: the chat shows its question and takes no answer until the chain is back. */
  aside: boolean
  /** For the head's meter of the session's context. */
  scale: ContextScale
}

interface Props {
  sessionId: string
  account: string | null
  /** The session still runs: new lines are fetched every few seconds. */
  live: boolean
  chat?: ChatTarget
  onClose: () => void
}

/** A reply sent from this window, shown until the transcript has a prompt or an answer after the line it was sent at. */
interface SentLine {
  line: FeedLine
  after: number
}

/** The whole transcript of a session: prompts, texts uncut, tool calls with their shell commands; with `chat`, a reply box under it. */
export function TranscriptWindow({ sessionId, account, live, chat, onClose }: Props) {
  const { transcript, imageUrl, sentFileUrl } = useLive()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  /** How many lines of the session's transcript are read. */
  const count = useRef(0)
  const [lines, setLines] = useState<FeedLine[] | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<SentLine[]>([])
  const [viewing, setViewing] = useState<number | null>(null)
  const all = lines == null ? null : [...lines, ...sent.filter((each) => !lines.slice(each.after).some(isReply)).map((each) => each.line)]
  const remoteUrl = chat?.session.remoteUrl
  const answered = new Map<string, AskAnswers>((all ?? []).flatMap((line) => (line.answers?.ask === undefined ? [] : [[line.answers.ask, line.answers.answers]])))
  const asks = new Map<string, Ask>((all ?? []).flatMap((line) => (line.ask === undefined ? [] : [[line.ask.id, line.ask]])))
  const media = transcriptMedia(
    all ?? [],
    { image: (tool, index) => imageUrl(sessionId, tool, index), file: (name) => sentFileUrl(sessionId, name) },
    t.session.chat.picture,
  )
  // An answered question shows as the card of its answer, the one the session waits on — in the panel under the chat.
  const entries =
    all == null
      ? null
      : feedEntries(all.filter((line) => line.ask === undefined || !(answered.has(line.ask.id) || (chat !== undefined && chat.session.ask?.id === line.ask.id))))
  const edits = editTotals(all ?? [])

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  useEffect(() => {
    count.current = 0
    setLines(undefined)
  }, [sessionId])

  // Delivering an answer stops the session for a while: the lines read so far stay, reading goes on from them.
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      const from = count.current
      try {
        const found = await transcript(sessionId, from)
        if (!alive) return
        setError(null)
        if (found === null) {
          if (from === 0) setLines(null)
        } else if (from === 0 || found.length > 0) {
          count.current = from + found.length
          setLines((current) => (from === 0 || current == null ? found : [...current, ...found]))
        }
      } catch (reason) {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason))
      }
      if (alive && live) timer = setTimeout(() => void read(), POLL_MS)
    }
    void read()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [sessionId, live])

  useLayoutEffect(() => {
    const list = listRef.current
    if (list !== null && pinned.current) list.scrollTop = list.scrollHeight
  }, [lines, sent])

  const onScroll = () => {
    const list = listRef.current
    if (list !== null) pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight < PINNED_SLACK
  }

  return (
    <dialog
      ref={dialogRef}
      className={`session-window transcript${chat === undefined ? '' : ' transcript--chat'}`}
      aria-label={t.session.transcriptDialog(sessionId.slice(0, 8))}
      onClose={(event) => {
        event.stopPropagation()
        onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.stopPropagation()
      }}
      onClick={(event) => {
        event.stopPropagation()
        if (event.target === dialogRef.current) dialogRef.current.close()
      }}
    >
      <div className="session-window__body">
        <header className="panel__head">
          <h2 className="panel__task">
            <span className="panel__key">{chat?.task ?? sessionId.slice(0, 8)}</span>
            <span className="panel__title">{chat === undefined ? t.session.transcriptTitle : `${t.session.chat.title} · ${sessionId.slice(0, 8)}`}</span>
            <AccountTag email={account} />
          </h2>
          <HeadFacts session={chat?.session ?? null} scale={chat?.scale ?? null} edits={edits} />
          {remoteUrl != null && (
            <a
              className="panel__remote"
              href={remoteUrl}
              target="_blank"
              rel="noreferrer"
              title={`${t.session.openRemote}${account === null ? '' : t.session.onlyIn(account)}`}
              aria-label={t.session.openRemote}
            >
              ↗
            </a>
          )}
          <button type="button" className="panel__close" aria-label={t.session.closeTranscript} onClick={() => dialogRef.current?.close()}>
            ×
          </button>
        </header>
        {error !== null && <p className="notice notice--error">{error}</p>}
        {error === null && lines === undefined && <p className="placeholder">{t.common.reading}</p>}
        {lines === null && <p className="placeholder">{t.session.notFound}</p>}
        {entries != null && (
          <div ref={listRef} className="transcript__scroll" onScroll={onScroll}>
            <ol className="transcript__lines">
              {entries.map((entry, index) =>
                entry.kind === 'gap' ? (
                  <li key={index} className="transcript__gap">
                    <LineTime at={entry.at} />
                  </li>
                ) : entry.kind === 'tools' ? (
                  <li key={index} className="transcript__entry transcript__entry--tools">
                    <LineTime at={entry.calls[0]!.line.at} hover />
                    <ToolGroup calls={entry.calls} media={media} onOpen={setViewing} />
                  </li>
                ) : (
                  <li key={index} className={`transcript__entry transcript__entry--${entry.line.kind}`}>
                    <LineTime at={entry.line.at} hover={!isReply(entry.line)} />
                    <Line line={entry.line} chat={chat} asks={asks} media={media} onOpen={setViewing} />
                  </li>
                ),
              )}
            </ol>
          </div>
        )}
        {chat !== undefined && (
          <div className="transcript__foot">
            {chat.session.lamp === 'working' && chat.session.turn !== null && <TurnLine turn={chat.session.turn} />}
            <ChatComposer
              key={chat.session.sessionId}
              project={chat.project}
              task={chat.task}
              session={chat.session}
              aside={chat.aside}
              onSent={(line) => {
                pinned.current = true
                setSent((now) => [...now, { line, after: lines?.length ?? 0 }])
              }}
            />
          </div>
        )}
      </div>
      {viewing !== null && media.items[viewing] !== undefined && (
        <MediaViewer items={media.items} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      )}
    </dialog>
  )
}

/** The turn in progress, as the Claude app shows it: "23с · 81 токен · Думает", the clock ticking every second. */
function TurnLine({ turn }: { turn: Turn }) {
  const now = useNow(TICK_MS)
  const elapsed = turn.startedAt === '' ? null : formatElapsed(now.getTime() - Date.parse(turn.startedAt))
  return (
    <Tipped inline align="start" className="transcript__turn" tip={t.session.chat.turnTip}>
      <span className="lamp lamp--working" aria-hidden="true" />
      <span className="transcript__turn-text">
        {[elapsed, t.session.chat.turnTokens(formatTokens(turn.outputTokens), turn.outputTokens), turn.tool ?? t.session.chat.thinking]
          .filter((part) => part !== null)
          .join(' · ')}
      </span>
    </Tipped>
  )
}

interface LineProps {
  line: FeedLine
  chat: ChatTarget | undefined
  asks: Map<string, Ask>
  media: TranscriptMedia
  onOpen: (place: number) => void
}

/** A line that is no call: a text of the session, a reply of the user, a question, an error. */
function Line({ line, chat, asks, media, onOpen }: LineProps) {
  if (line.ask !== undefined) return <AskCard ask={line.ask} answers={line.ask.id === chat?.session.ask?.id ? null : {}} />
  if (isReply(line)) {
    return (
      <>
        {line.answers !== undefined && Object.keys(line.answers.answers).length > 0 && (
          <AnswerCard answers={line.answers.answers} ask={line.answers.ask === undefined ? undefined : asks.get(line.answers.ask)} />
        )}
        {(line.text !== '' || (line.files?.length ?? 0) > 0) && <UserBubble text={line.text} files={line.files ?? []} media={media} onOpen={onOpen} />}
      </>
    )
  }
  if (line.kind === 'text') {
    return (
      <div className="markdown">
        <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN}>
          {line.text}
        </Markdown>
      </div>
    )
  }
  if (line.kind === 'image') return <Thumbs places={media.byTool.get(line.tool ?? '') ?? []} items={media.items} onOpen={onOpen} />
  return <span className="transcript__plain">{line.text}</span>
}

/**
 * The head's facts of a chat: how full the context is and the branch, and the edits of the session in any transcript;
 * their figures in full in the tip.
 */
function HeadFacts({ session, scale, edits }: { session: SessionView | null; scale: ContextScale | null; edits: EditTotal | null }) {
  const branch = session?.branch ?? null
  const context = session !== null && scale !== null && session.contextTokens > 0
  if (!context && branch === null && edits === null) return null
  const tip = [
    context ? `${t.context.label}: ${t.context.of(formatTokens(session.contextTokens), formatTokens(scale.window), Math.round(contextFill(session.contextTokens, scale).percent))}` : null,
    branch === null ? null : t.session.chat.head.branch(branch),
    edits === null ? null : t.session.chat.head.edits(edits.added, edits.removed),
  ].filter((part) => part !== null)
  return (
    <Tipped className="transcript__facts" tip={tip.map((part) => <div key={part}>{part}</div>)} focusable>
      {context && <ContextMeter tokens={session.contextTokens} scale={scale} />}
      {branch !== null && <span className="transcript__branch">{branch}</span>}
      {edits !== null && <EditSize {...edits} />}
    </Tipped>
  )
}

/** Hours and minutes, the date and the seconds in the tip; `hover` shows it only while the line is pointed at. */
function LineTime({ at, hover = false }: { at: string; hover?: boolean }) {
  if (at === '') return null
  const date = new Date(at)
  return (
    <Tipped inline align="start" className={`transcript__time${hover ? ' transcript__time--hover' : ''}`} tip={FULL_TIME().format(date)}>
      <time dateTime={at}>{LINE_TIME().format(date)}</time>
    </Tipped>
  )
}

interface BubbleProps {
  text: string
  files: string[]
  media: TranscriptMedia
  onOpen: (place: number) => void
}

/** A message of the user on the right: their words and the files they sent, pictures as thumbnails; a long one folds. */
function UserBubble({ text, files, media, onOpen }: BubbleProps) {
  const [open, setOpen] = useState(false)
  const long = text.split('\n').length > FOLD_LINES || text.length > FOLD_CHARS
  return (
    <div className={`bubble${long && !open ? ' bubble--folded' : ''}`}>
      {text !== '' && <span className="transcript__plain bubble__text">{text}</span>}
      {files.length > 0 && (
        <ul className="bubble__files">
          {files.map((file, index) => {
            const place = media.byFile.get(file)
            const chip = <span className="chat__file">📎 {fileName(file)}</span>
            return (
              <li key={`${file}-${index}`}>
                {place === undefined ? chip : <Thumb item={media.items[place]!} onOpen={() => onOpen(place)} fallback={chip} />}
              </li>
            )
          })}
        </ul>
      )}
      {long && (
        <button type="button" className="bubble__more" onClick={() => setOpen(!open)}>
          {open ? t.session.showLess : t.session.showMore}
        </button>
      )}
    </div>
  )
}

function isReply(line: FeedLine): boolean {
  return line.kind === 'answer' || line.kind === 'prompt'
}
