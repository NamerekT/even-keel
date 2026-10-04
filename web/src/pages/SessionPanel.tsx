import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TaskSession } from '../../../src/chain/launches.js'
import type { LimitHold } from '../../../src/chain/relay.js'
import type { RemoteOff } from '../../../src/sessions/remote.js'
import type { CacheWindow, FeedLine, TokenTotals } from '../../../src/sessions/transcript.js'
import type { ContextScale, SessionRecord, SessionView, TrackerUrls } from '../../../src/state.js'
import { formatClock, formatMoment, formatTokens } from '../format.js'
import { useNow } from '../layout/useNow.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { checkpointHandoffs, issueLink, sessionElapsed, taskProject, tokenTotal, type ChainBlock } from '../state.js'
import { CacheClock, TTL_LABELS } from '../ui/CacheClock.js'
import { ContextMeter } from '../ui/ContextMeter.js'
import { Lamp, LAMP_LABELS } from '../ui/Lamp.js'

const STARTED = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const FEED_TIME = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const PINNED_SLACK = 24

const HOW: Record<TaskSession['how'], string> = {
  launch: 'Запуск цепочкой',
  relay: 'Новая после лимита',
  restart: 'Перезапуск',
  checkpoint: 'По контрольной точке',
  manual: 'Запущена вручную',
}

const REPLACED: Record<NonNullable<TaskSession['replaced']>['how'], string> = {
  restart: 'заменена вручную',
  checkpoint: 'поставила контрольную точку',
}

const REMOTE_OFF: Record<RemoteOff, string> = {
  starting: 'Remote Control поднимается — ссылка будет через пару секунд.',
  disabled: 'Remote Control выключен: в /config папки аккаунта нет «remoteControlAtStartup».',
  'no-bridge': 'Сессия не подняла Remote Control — отсюда её не открыть.',
  lost: 'Remote Control отвалился — с телефона не открыть. Не довела задачу — «Новая сессия».',
}

interface Props {
  block: ChainBlock
  scale: ContextScale
  trackerUrls: TrackerUrls
  onClose: () => void
}

export function SessionPanel({ block, scale, trackerUrls, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const [opened, setOpened] = useState<TaskSession | null>(null)
  const link = issueLink(trackerUrls, block.id)
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
            <a href={link} target="_blank" rel="noreferrer" title="Открыть задачу в трекере">
              {task}
            </a>
          )}
        </h2>
        <button ref={closeRef} type="button" className="panel__close" aria-label="Закрыть панель" onClick={onClose}>
          ×
        </button>
      </header>
      {(block.status !== null || block.skipped) && (
        <p className="panel__status">
          {block.status}
          {block.skipped && <span className="panel__flag">пропущена</span>}
        </p>
      )}
      <Actions block={block} />
      {block.session === null ? (
        <p className="placeholder">Сессии по этой задаче ещё не было.</p>
      ) : (
        <SessionBody session={block.session} limit={block.limit} scale={scale} />
      )}
      {block.sessions.length > 0 && (
        <SessionList rows={block.sessions} current={block.session?.sessionId ?? null} onOpen={setOpened} />
      )}
      {opened !== null && <SessionWindow key={opened.sessionId} row={opened} scale={scale} onClose={() => setOpened(null)} />}
    </aside>
  )
}

function Actions({ block }: { block: ChainBlock }) {
  const { send, sending, failure } = useCommand()
  const body = { project: taskProject(block.id), task: block.id }
  const session = block.session
  const live = block.current ? session : null
  const midTurn = live !== null && (live.lamp === 'working' || live.waitingFor !== null)
  const account = session?.account == null ? '' : `\nRemote Control покажет её только в аккаунте ${session.account}`
  const remoteOff = session === null || session.remoteUrl !== null ? null : REMOTE_OFF[session.remoteOff ?? 'no-bridge']
  const buttons = session?.remoteUrl != null || block.open

  if (!buttons) return null
  return (
    <>
      <div className="panel__actions">
        {session?.remoteUrl != null && (
          <a
            className="button button--primary"
            href={session.remoteUrl}
            target="_blank"
            rel="noreferrer"
            title={`Открыть сессию через Remote Control${account}`}
          >
            Открыть
          </a>
        )}
        {block.open && live !== null && (
          <button
            type="button"
            className="button"
            disabled={sending || midTurn}
            title="Остановит эту сессию и запустит новую в той же рабочей папке с передачей дел. Статус в трекере не меняется."
            onClick={() => void send('chain/restart', body)}
          >
            Новая сессия
          </button>
        )}
        {block.open &&
          (block.skipped ? (
            <button
              type="button"
              className="button"
              disabled={sending}
              title="Задача пропущена — цепочка её не берёт, пока не вернёшь."
              onClick={() => void send('chain/unskip', body)}
            >
              Вернуть
            </button>
          ) : (
            <button
              type="button"
              className="button"
              disabled={sending || midTurn}
              title={
                block.current
                  ? 'Цепочка перестанет ждать задачу и возьмёт следующую. Статус в трекере и сессия не меняются.'
                  : 'Цепочка не возьмёт задачу, пока не вернёшь её. Статус в трекере не меняется.'
              }
              onClick={() => void send('chain/skip', body)}
            >
              Пропустить
            </button>
          ))}
        {midTurn && <span className="panel__hint">идёт ход — замена и пропуск после него</span>}
      </div>
      {remoteOff !== null && (
        <p className="panel__remote-off" title={session?.account == null ? undefined : `Аккаунт: ${session.account}`}>
          {remoteOff}
        </p>
      )}
      {failure !== null && <p className="notice notice--error">{failure}</p>}
    </>
  )
}

function SessionBody({ session, limit, scale }: { session: SessionView; limit: LimitHold | null; scale: ContextScale }) {
  const now = useNow(1_000)
  const note = session.apiError ?? (session.waitingFor === null ? null : `Ждёт: ${session.waitingFor}`)

  return (
    <>
      {note !== null && <p className="notice notice--error">{note}</p>}
      {limit !== null && <p className="notice notice--warn">{limitPlan(limit, now)}</p>}
      <dl className="panel__facts">
        <div className="panel__fact">
          <dt>Сессия</dt>
          <dd className={`panel__state panel__state--${session.lamp}`}>{LAMP_LABELS[session.lamp]}</dd>
        </div>
        <div className="panel__fact">
          <dt>Время</dt>
          <dd className="panel__big">{formatClock(sessionElapsed(session, now))}</dd>
          <dd className="panel__sub">
            с <time dateTime={session.startedAt}>{STARTED.format(new Date(session.startedAt))}</time>
          </dd>
        </div>
        <div className="panel__fact">
          <dt>Кэш</dt>
          {session.cache === null ? <dd className="panel__big">—</dd> : <CacheFact cache={session.cache} />}
        </div>
        <div className="panel__fact panel__fact--wide">
          <dt>Контекст</dt>
          <dd>
            <ContextMeter tokens={session.contextTokens} scale={scale} full />
          </dd>
        </div>
        <TokensFact tokens={session.tokens} />
      </dl>
      {session.lamp === 'finished' ? <RecordFeed sessionId={session.sessionId} /> : <Feed lines={session.feed} />}
    </>
  )
}

function RecordFeed({ sessionId }: { sessionId: string }) {
  const { session } = useLive()
  const [lines, setLines] = useState<FeedLine[] | null>(null)

  useEffect(() => {
    let alive = true
    session(sessionId).then(
      (found) => alive && setLines(found?.feed ?? []),
      () => alive && setLines([]),
    )
    return () => {
      alive = false
    }
  }, [sessionId])

  return lines === null ? <p className="placeholder">Читаю транскрипт…</p> : <Feed lines={lines} />
}

function CacheFact({ cache }: { cache: CacheWindow }) {
  return (
    <>
      <dd className="panel__big">
        <CacheClock cache={cache} bare />
      </dd>
      <dd className="panel__sub">срок {TTL_LABELS[cache.ttl]}</dd>
    </>
  )
}

function TokensFact({ tokens }: { tokens: TokenTotals }) {
  const parts: [string, number][] = [
    ['ввод', tokens.input],
    ['вывод', tokens.output],
    ['чтение кэша', tokens.cacheRead],
    ['запись кэша', tokens.cacheWrite],
  ]
  return (
    <div className="panel__fact panel__fact--wide panel__tokens">
      <dt>Токены</dt>
      <dd className="panel__big">{formatTokens(tokenTotal(tokens))}</dd>
      <dd className="panel__split">
        {parts.map(([label, value]) => (
          <span key={label} className="panel__part">
            <span className="panel__part-label">{label}</span>
            <b>{formatTokens(value)}</b>
          </span>
        ))}
      </dd>
    </div>
  )
}

function limitPlan(hold: LimitHold, now: Date): string {
  if (hold.resetsAt === null) return 'Время сброса лимита неизвестно — новая сессия запустится, как только сменишь аккаунт.'
  const at = formatMoment(hold.resetsAt, now)
  return hold.then === 'resume'
    ? `После сброса лимита в ${at} диспетчер продолжит эту сессию — кэш ещё будет тёплым.`
    : `После сброса лимита в ${at} (или сразу после смены аккаунта) диспетчер запустит новую сессию в той же рабочей папке.`
}

interface SessionListProps {
  rows: TaskSession[]
  current: string | null
  onOpen: (row: TaskSession) => void
}

function SessionList({ rows, current, onOpen }: SessionListProps) {
  const handoffs = checkpointHandoffs(rows)
  return (
    <section className="panel__sessions" aria-label="Сессии по задаче">
      <h3 className="panel__feed-title">
        Сессии по задаче{handoffs > 0 && ` · передач по контрольной точке: ${handoffs}`}
      </h3>
      <ul className="sessions">
        {rows.map((row) => (
          <li key={row.sessionId}>
            <button type="button" className="sessions__row" onClick={() => onOpen(row)}>
              <time className="sessions__time" dateTime={row.at}>
                {STARTED.format(new Date(row.at))}
              </time>
              <span className="sessions__how">
                {HOW[row.how]}
                {row.resumed > 0 && ` · продолжена после лимита${row.resumed > 1 ? ` ×${row.resumed}` : ''}`}
                {row.left !== undefined && ` · ${leftText(row.left)}`}
                {row.replaced !== undefined && ` · ${REPLACED[row.replaced.how]}`}
              </span>
              <span className="sessions__id">{row.sessionId.slice(0, 8)}</span>
              {row.sessionId === current && <span className="sessions__now">сейчас</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function leftText(left: NonNullable<TaskSession['left']>): string {
  return left.reason === 'skip' ? 'пропущена' : `отложена: ждёт ${left.blockers.join(', ')}`
}

function SessionWindow({ row, scale, onClose }: { row: TaskSession; scale: ContextScale; onClose: () => void }) {
  const { session } = useLive()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [record, setRecord] = useState<SessionRecord | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  useEffect(() => {
    let alive = true
    session(row.sessionId).then(
      (found) => alive && setRecord(found),
      (reason: unknown) => alive && setError(reason instanceof Error ? reason.message : String(reason)),
    )
    return () => {
      alive = false
    }
  }, [row.sessionId])

  const started = record?.startedAt ?? row.at
  const last = record?.lastActivityAt ?? null

  return (
    <dialog
      ref={dialogRef}
      className="session-window"
      aria-label={`Сессия ${row.sessionId.slice(0, 8)}`}
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.stopPropagation()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current.close()
      }}
    >
      <div className="session-window__body">
        <header className="panel__head">
          <h2 className="panel__task">
            <span className="panel__key">{row.sessionId.slice(0, 8)}</span>
            <span className="panel__title">{HOW[row.how]}</span>
          </h2>
          <button type="button" className="panel__close" aria-label="Закрыть окно сессии" onClick={() => dialogRef.current?.close()}>
            ×
          </button>
        </header>
        {error !== null && <p className="notice notice--error">{error}</p>}
        {error === null && record === undefined && <p className="placeholder">Читаю транскрипт…</p>}
        {record === null && <p className="placeholder">Транскрипт этой сессии не найден.</p>}
        {record !== null && record !== undefined && (
          <>
            <dl className="panel__facts">
              <div className="panel__fact">
                <dt>Запущена</dt>
                <dd>
                  <time dateTime={started}>{STARTED.format(new Date(started))}</time>
                </dd>
              </div>
              <div className="panel__fact">
                <dt>Последний ход</dt>
                <dd>{last === null ? '—' : <time dateTime={last}>{STARTED.format(new Date(last))}</time>}</dd>
              </div>
              <div className="panel__fact">
                <dt>Работала</dt>
                <dd className="panel__big">{last === null ? '—' : formatClock(Date.parse(last) - Date.parse(started))}</dd>
              </div>
              <div className="panel__fact panel__fact--wide">
                <dt>Контекст в конце</dt>
                <dd>
                  <ContextMeter tokens={record.contextTokens} scale={scale} full />
                </dd>
              </div>
              <TokensFact tokens={record.tokens} />
              {(record.branch !== null || record.workdir !== null) && (
                <div className="panel__fact panel__fact--wide">
                  <dt>Ветка и папка</dt>
                  <dd className="session-window__place">
                    {record.branch ?? '—'} · {record.workdir ?? '—'}
                  </dd>
                </div>
              )}
            </dl>
            {record.apiError !== null && <p className="notice notice--error">{record.apiError}</p>}
            <Feed lines={record.feed} />
          </>
        )}
      </div>
    </dialog>
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
