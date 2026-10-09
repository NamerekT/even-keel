import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import { localized, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'

const LINE_TIME = localized((language) => new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit', second: '2-digit' }))

/** The whole transcript of a session: prompts, texts uncut, tool calls with their shell commands. */
export function TranscriptWindow({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { transcript } = useLive()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const [lines, setLines] = useState<FeedLine[] | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [reads, setReads] = useState(0)

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  useEffect(() => {
    let alive = true
    transcript(sessionId).then(
      (found) => {
        if (!alive) return
        setLines(found)
        setError(null)
      },
      (reason: unknown) => alive && setError(reason instanceof Error ? reason.message : String(reason)),
    )
    return () => {
      alive = false
    }
  }, [sessionId, reads])

  useLayoutEffect(() => {
    const list = listRef.current
    if (list !== null) list.scrollTop = list.scrollHeight
  }, [lines])

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
          </h2>
          <button type="button" className="button transcript__refresh" onClick={() => setReads((count) => count + 1)}>
            {t.session.refresh}
          </button>
          <button type="button" className="panel__close" aria-label={t.session.closeTranscript} onClick={() => dialogRef.current?.close()}>
            ×
          </button>
        </header>
        {error !== null && <p className="notice notice--error">{error}</p>}
        {error === null && lines === undefined && <p className="placeholder">{t.common.reading}</p>}
        {lines === null && <p className="placeholder">{t.session.notFound}</p>}
        {lines !== null && lines !== undefined && (
          <ol ref={listRef} className="feed transcript__lines">
            {lines.map((line, index) => (
              <li key={`${line.at}-${index}`} className={`feed__line feed__line--${line.kind}`}>
                <time className="feed__time" dateTime={line.at}>
                  {line.at === '' ? '' : LINE_TIME().format(new Date(line.at))}
                </time>
                <div className="feed__text">
                  {line.kind === 'prompt' && <span className="transcript__label">{t.session.prompt}</span>}
                  {line.text}
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
