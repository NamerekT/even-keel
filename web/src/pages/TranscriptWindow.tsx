import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import { localized, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { AccountTag } from '../ui/AccountTag.js'
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

interface Props {
  sessionId: string
  account: string | null
  /** The session still runs: new lines are fetched every few seconds. */
  live: boolean
  onClose: () => void
}

/** The whole transcript of a session: prompts, texts uncut, tool calls with their shell commands. */
export function TranscriptWindow({ sessionId, account, live, onClose }: Props) {
  const { transcript } = useLive()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const pinned = useRef(true)
  const [lines, setLines] = useState<FeedLine[] | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let count = 0
    const read = async () => {
      try {
        const found = await transcript(sessionId, count)
        if (!alive) return
        setError(null)
        if (found === null) {
          if (count === 0) setLines(null)
        } else if (count === 0 || found.length > 0) {
          count += found.length
          setLines((current) => (current == null ? found : [...current, ...found]))
        }
      } catch (reason) {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason))
      }
      if (alive && live) timer = setTimeout(() => void read(), POLL_MS)
    }
    setLines(undefined)
    void read()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [sessionId, live])

  useLayoutEffect(() => {
    const list = listRef.current
    if (list !== null && pinned.current) list.scrollTop = list.scrollHeight
  }, [lines])

  const onScroll = () => {
    const list = listRef.current
    if (list !== null) pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight < PINNED_SLACK
  }

  return (
    <dialog
      ref={dialogRef}
      className="session-window transcript"
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
            <span className="panel__key">{sessionId.slice(0, 8)}</span>
            <span className="panel__title">{t.session.transcriptTitle}</span>
            <AccountTag email={account} />
          </h2>
          <button type="button" className="panel__close" aria-label={t.session.closeTranscript} onClick={() => dialogRef.current?.close()}>
            ×
          </button>
        </header>
        {error !== null && <p className="notice notice--error">{error}</p>}
        {error === null && lines === undefined && <p className="placeholder">{t.common.reading}</p>}
        {lines === null && <p className="placeholder">{t.session.notFound}</p>}
        {lines != null && (
          <ol ref={listRef} className="feed transcript__lines" onScroll={onScroll}>
            {lines.map((line, index) => (
              <li key={index} className={`feed__line feed__line--${line.kind}`}>
                <time className="feed__time" dateTime={line.at}>
                  {line.at === '' ? '' : LINE_TIME().format(new Date(line.at))}
                </time>
                <div className="feed__text">
                  {line.kind === 'prompt' && <span className="transcript__label">{t.session.prompt}</span>}
                  {line.kind === 'text' ? (
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
      </div>
    </dialog>
  )
}
