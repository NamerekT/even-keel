import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Ask, AskAnswers } from '../../../src/sessions/ask.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import type { SessionView } from '../../../src/state.js'
import { localized, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { AccountTag } from '../ui/AccountTag.js'
import { Tipped } from '../ui/Tipped.js'
import { AnswerCard, AskCard } from './AskPanel.js'
import { ChatComposer } from './ChatComposer.js'
import { fileName } from './feedLine.js'
import '../ui/markdown.css'

const LINE_TIME = localized((language) => new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }))
const FULL_TIME = localized((language) => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'medium' }))
const POLL_MS = 3_000
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
  const { transcript } = useLive()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const pinned = useRef(true)
  /** How many lines of the session's transcript are read. */
  const count = useRef(0)
  const [lines, setLines] = useState<FeedLine[] | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<SentLine[]>([])
  const all = lines == null ? null : [...lines, ...sent.filter((each) => !lines.slice(each.after).some(isReply)).map((each) => each.line)]
  const remoteUrl = chat?.session.remoteUrl
  const answered = new Map<string, AskAnswers>((all ?? []).flatMap((line) => (line.answers?.ask === undefined ? [] : [[line.answers.ask, line.answers.answers]])))
  const asks = new Map<string, Ask>((all ?? []).flatMap((line) => (line.ask === undefined ? [] : [[line.ask.id, line.ask]])))
  // An answered question shows as the card of its answer, the one the session waits on — in the panel under the chat.
  const shown = all?.filter((line) => line.ask === undefined || !(answered.has(line.ask.id) || (chat !== undefined && chat.session.ask?.id === line.ask.id)))

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
        {shown != null && (
          <ol ref={listRef} className="feed transcript__lines" onScroll={onScroll}>
            {shown.map((line, index) => (
              <li key={index} className={`feed__line feed__line--${line.kind}`}>
                <LineTime at={line.at} />
                <div className="feed__text">
                  {line.ask !== undefined ? (
                    <AskCard ask={line.ask} answers={line.ask.id === chat?.session.ask?.id ? null : {}} />
                  ) : line.kind === 'prompt' || line.kind === 'answer' ? (
                    <>
                      {line.answers !== undefined && Object.keys(line.answers.answers).length > 0 && (
                        <AnswerCard answers={line.answers.answers} ask={line.answers.ask === undefined ? undefined : asks.get(line.answers.ask)} />
                      )}
                      {(line.text !== '' || (line.files?.length ?? 0) > 0) && <UserBubble text={line.text} files={line.files ?? []} />}
                    </>
                  ) : line.kind === 'text' ? (
                    <div className="markdown">
                      <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN}>
                        {line.text}
                      </Markdown>
                    </div>
                  ) : (
                    <span className="transcript__plain">{line.text}</span>
                  )}
                  {line.detail !== undefined && <pre className="transcript__detail">{line.detail}</pre>}
                </div>
              </li>
            ))}
          </ol>
        )}
        {chat !== undefined && (
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
        )}
      </div>
    </dialog>
  )
}

/** Hours and minutes; the date and the seconds in the tip. */
function LineTime({ at }: { at: string }) {
  if (at === '') return <span className="feed__time" />
  const date = new Date(at)
  return (
    <Tipped inline align="start" className="feed__time" tip={FULL_TIME().format(date)}>
      <time dateTime={at}>{LINE_TIME().format(date)}</time>
    </Tipped>
  )
}

/** A message of the user on the right: their words and the files they sent; a long one folds. */
function UserBubble({ text, files }: { text: string; files: string[] }) {
  const [open, setOpen] = useState(false)
  const long = text.split('\n').length > FOLD_LINES || text.length > FOLD_CHARS
  return (
    <div className={`bubble${long && !open ? ' bubble--folded' : ''}`}>
      {text !== '' && <span className="transcript__plain bubble__text">{text}</span>}
      {files.length > 0 && (
        <ul className="bubble__files">
          {files.map((file, index) => (
            <li key={`${file}-${index}`} className="chat__file">
              📎 {fileName(file)}
            </li>
          ))}
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
