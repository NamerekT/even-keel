import { useEffect, useLayoutEffect, useRef } from 'react'
import type { RemoteOff } from '../../../src/sessions/remote.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import type { ContextScale, SessionView } from '../../../src/state.js'
import { formatClock, formatTokens } from '../format.js'
import { useNow } from '../layout/useNow.js'
import { issueLink, sessionElapsed, tokenTotal, type ChainBlock } from '../state.js'
import { ContextMeter } from '../ui/ContextMeter.js'
import { Lamp, LAMP_LABELS } from '../ui/Lamp.js'

const STARTED = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const FEED_TIME = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const PINNED_SLACK = 24

const REMOTE_OFF: Record<RemoteOff, string> = {
  starting: 'Remote Control поднимается — ссылка появится через несколько секунд.',
  disabled:
    'Remote Control не включается сам: в ~/.claude/settings.json нет «remoteControlAtStartup»: true. Включи его в /config — новые сессии поднимут мост.',
  'no-bridge':
    'Сессия не подняла Remote Control: в её записи ~/.claude/sessions/<pid>.json нет моста, хотя автозапуск включён. Открыть её отсюда нельзя.',
}

interface Props {
  block: ChainBlock
  scale: ContextScale
  trackerUrl: string | null
  onClose: () => void
}

export function SessionPanel({ block, scale, trackerUrl, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const link = issueLink(trackerUrl, block.id)
  const task = (
    <>
      <span className="panel__key">{block.id}</span>
      {block.title !== null && <span className="panel__title">{block.title}</span>}
    </>
  )

  useEffect(() => closeRef.current?.focus({ preventScroll: true }), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside className="panel" aria-label={`Сессия задачи ${block.id}`}>
      <header className="panel__head">
        <Lamp lamp={block.lamp} />
        <h2 className="panel__task">
          {link === null ? (
            task
          ) : (
            <a href={link} target="_blank" rel="noreferrer" title="Открыть задачу в Huly">
              {task}
            </a>
          )}
        </h2>
        <button ref={closeRef} type="button" className="panel__close" aria-label="Закрыть панель" onClick={onClose}>
          ×
        </button>
      </header>
      {block.status !== null && <p className="panel__status">{block.status}</p>}
      {block.session === null ? (
        <p className="placeholder">Сессии по этой задаче ещё не было.</p>
      ) : (
        <SessionBody session={block.session} scale={scale} />
      )}
    </aside>
  )
}

function SessionBody({ session, scale }: { session: SessionView; scale: ContextScale }) {
  const now = useNow(1_000)
  const { tokens } = session
  const note = session.apiError ?? (session.waitingFor === null ? null : `Ждёт: ${session.waitingFor}`)

  return (
    <>
      <dl className="panel__facts">
        <div className="panel__fact">
          <dt>Сессия</dt>
          <dd>{LAMP_LABELS[session.lamp]}</dd>
        </div>
        <div className="panel__fact">
          <dt>Запущена</dt>
          <dd>
            <time dateTime={session.startedAt}>{STARTED.format(new Date(session.startedAt))}</time>
          </dd>
        </div>
        <div className="panel__fact">
          <dt>В работе</dt>
          <dd className="panel__clock">{formatClock(sessionElapsed(session, now))}</dd>
        </div>
        <div className="panel__fact panel__fact--wide">
          <dt>Контекст</dt>
          <dd>
            <ContextMeter tokens={session.contextTokens} scale={scale} full />
          </dd>
        </div>
        <div className="panel__fact panel__fact--wide">
          <dt>Токены за сессию</dt>
          <dd>
            <strong className="panel__total">{formatTokens(tokenTotal(tokens))}</strong>
            <span className="panel__split">
              ввод {formatTokens(tokens.input)} · вывод {formatTokens(tokens.output)} · кэш: чтение{' '}
              {formatTokens(tokens.cacheRead)}, запись {formatTokens(tokens.cacheWrite)}
            </span>
          </dd>
        </div>
      </dl>
      {note !== null && <p className="notice notice--error">{note}</p>}
      {session.remoteUrl === null ? (
        <p className="panel__remote-off">{REMOTE_OFF[session.remoteOff ?? 'no-bridge']}</p>
      ) : (
        <a className="button button--primary panel__remote" href={session.remoteUrl} target="_blank" rel="noreferrer">
          Открыть сессию
        </a>
      )}
      <Feed lines={session.feed} />
    </>
  )
}

function Feed({ lines }: { lines: FeedLine[] }) {
  const listRef = useRef<HTMLOListElement>(null)
  const pinned = useRef(true)

  useLayoutEffect(() => {
    const list = listRef.current
    if (list !== null && pinned.current) list.scrollTop = list.scrollHeight
  }, [lines])

  const onScroll = () => {
    const list = listRef.current
    if (list !== null) pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight < PINNED_SLACK
  }

  return (
    <section className="panel__feed" aria-label="Ход работы">
      <h3 className="panel__feed-title">Ход работы</h3>
      {lines.length === 0 ? (
        <p className="placeholder">Сессия ещё ничего не сделала.</p>
      ) : (
        <ol ref={listRef} className="feed" onScroll={onScroll}>
          {lines.map((line, index) => (
            <li key={`${line.at}-${index}`} className={`feed__line feed__line--${line.kind}`}>
              <time className="feed__time" dateTime={line.at}>
                {line.at === '' ? '' : FEED_TIME.format(new Date(line.at))}
              </time>
              <span className="feed__text">{line.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
