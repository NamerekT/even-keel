import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AskAnswers } from '../../../src/sessions/ask.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import type { SessionView } from '../../../src/state.js'
import { localized, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { AccountTag } from '../ui/AccountTag.js'
import { AskCard } from './AskPanel.js'
import { ChatComposer } from './ChatComposer.js'
import '../ui/markdown.css'

const LINE_TIME = localized((language) => new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
const POLL_MS = 3_000
const PINNED_SLACK = 24

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
  const shown = lines == null ? null : [...lines, ...sent.filter((each) => !lines.slice(each.after).some(isReply)).map((each) => each.line)]
  const remoteUrl = chat?.session.remoteUrl
  const answered = new Map<string, AskAnswers>((shown ?? []).flatMap((line) => (line.answers === undefined ? [] : [[line.answers.ask, line.answers.answers]])))

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
                <time className="feed__time" dateTime={line.at}>
                  {line.at === '' ? '' : LINE_TIME().format(new Date(line.at))}
                </time>
                <div className="feed__text">
                  {line.kind === 'prompt' && <span className="transcript__label">{t.session.prompt}</span>}
                  {line.kind === 'answer' && <span className="transcript__label">{t.session.answer}</span>}
                  {line.ask !== undefined && !(chat !== undefined && waitsOn(chat, line.ask.id, answered)) ? (
                    <AskCard ask={line.ask} answers={answered.get(line.ask.id) ?? (chat?.session.ask?.id === line.ask.id ? null : {})} />
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

/** The question the chat's answer panel shows: its card in the transcript would only repeat it. */
function waitsOn(chat: ChatTarget, ask: string, answered: Map<string, AskAnswers>): boolean {
  return chat.session.ask?.id === ask && !answered.has(ask)
}

function isReply(line: FeedLine): boolean {
  return line.kind === 'answer' || line.kind === 'prompt'
}
