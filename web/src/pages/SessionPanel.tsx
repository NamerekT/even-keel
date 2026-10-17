import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fixTaskOf, isFixName } from '../../../src/chain/fix.js'
import type { TaskSession } from '../../../src/chain/launches.js'
import type { LimitHold } from '../../../src/chain/relay.js'
import type { CacheWindow, FeedLine, TokenTotals } from '../../../src/sessions/transcript.js'
import type { ContextScale, SessionRecord, SessionView } from '../../../src/state.js'
import { formatClock, formatMoment, formatTokens } from '../format.js'
import { localized, say, t } from '../i18n/index.js'
import { useNow } from '../layout/useNow.js'
import { useLive } from '../live/context.js'
import { useCommand, useHold } from '../live/useCommand.js'
import { cacheTone, checkpointHandoffs, contextFill, sessionElapsed, taskProject, tokenTotal, type ChainBlock } from '../state.js'
import { AccountTag } from '../ui/AccountTag.js'
import { CacheClock } from '../ui/CacheClock.js'
import { ContextMeter } from '../ui/ContextMeter.js'
import { Lamp } from '../ui/Lamp.js'
import { StartCard } from '../ui/SessionStart.js'
import { useTip } from '../ui/useTip.js'
import './facts.css'

const TranscriptWindow = lazy(async () => ({ default: (await import('./TranscriptWindow.js')).TranscriptWindow }))

const STARTED = localized((language) => new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))
const FEED_TIME = localized((language) => new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
const PINNED_SLACK = 24
const REPLACE_WAIT_MS = 90_000

interface Props {
  block: ChainBlock
  scale: ContextScale
  onCard: (task: string) => void
  onClose: () => void
}

export function SessionPanel({ block, scale, onCard, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const [opened, setOpened] = useState<TaskSession | null>(null)
  const remoteUrl = block.session?.remoteUrl ?? null
  const account = block.session?.account == null ? '' : t.session.onlyIn(block.session.account)
  // The current session is read and answered in the chat window, opened from the actions.
  const chat = (block.current || block.aside === true || block.loose === true) && block.session !== null

  useEffect(() => closeRef.current?.focus({ preventScroll: true }), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside className="panel" aria-label={t.session.panel(block.id)}>
      <header className="panel__head">
        <Lamp lamp={block.lamp} />
        <h2 className="panel__task">
          {isFixName(block.id) ? (
            <>
              <span className="panel__key">{block.id}</span>
              <span className="panel__title">{block.title}</span>
            </>
          ) : (
            <button type="button" className="panel__card" title={t.chain.openCard} onClick={() => onCard(block.id)}>
              <span className="panel__key">{block.id}</span>
              {block.title !== null && <span className="panel__title">{block.title}</span>}
            </button>
          )}
        </h2>
        {remoteUrl !== null && (
          <a className="panel__remote" href={remoteUrl} target="_blank" rel="noreferrer" title={`${t.session.openRemote}${account}`} aria-label={t.session.openRemote}>
            ↗
          </a>
        )}
        <button ref={closeRef} type="button" className="panel__close" aria-label={t.session.closePanel} onClick={onClose}>
          ×
        </button>
      </header>
      {(block.status !== null || block.skipped || block.interrupted) && (
        <p className="panel__status">
          {block.status}
          {block.skipped && <span className="panel__flag">{t.session.skipped}</span>}
          {block.interrupted && <span className="panel__flag">{t.session.interrupted}</span>}
        </p>
      )}
      <Actions block={block} />
      {block.start !== null ? (
        <>
          <StartCard start={block.start} />
          {block.start.phase === 'answer' && block.session !== null && (
            <Feed lines={block.session.feed} sessionId={block.session.sessionId} account={block.session.account} live whole={!chat} />
          )}
        </>
      ) : block.session === null ? (
        block.sessions.length === 0 && <p className="placeholder">{t.session.none}</p>
      ) : (
        <SessionBody session={block.session} limit={block.limit} scale={scale} whole={!chat} />
      )}
      {block.sessions.length > 0 && (
        <SessionList rows={block.sessions} current={block.session?.sessionId ?? null} onOpen={setOpened} />
      )}
      {opened !== null && (
        <SessionWindow
          key={opened.sessionId}
          row={opened}
          live={block.session?.sessionId === opened.sessionId && block.session.lamp !== 'finished'}
          scale={scale}
          onClose={() => setOpened(null)}
        />
      )}
    </aside>
  )
}

function Actions({ block }: { block: ChainBlock }) {
  const { send, sending, failure } = useCommand()
  const [chatting, setChatting] = useState(false)
  const fix = isFixName(block.id)
  // The row of a fix is one of its episodes; the service knows the fix by its name.
  const body = { project: taskProject(block.id), task: fix ? fixTaskOf(block.id) : block.id }
  const session = block.session
  const live = block.current ? session : null
  // A task that made way for the fix of main keeps its chat, shut until the chain takes it again.
  const aside = block.aside === true
  // Once the chain stopped, the session that lives on is still answered from the chat.
  const talking = live ?? (aside || block.loose === true ? session : null)
  const midTurn = live !== null && (live.lamp === 'working' || live.waitingFor !== null)
  const remoteOff = session === null || session.remoteUrl !== null ? null : t.session.remote[session.remoteOff ?? 'no-bridge']
  const replacing = useHold(`${block.current}|${session?.sessionId ?? ''}`, REPLACE_WAIT_MS)
  const starting = replacing.on || (block.current && block.start !== null)
  const waiting = !aside && talking?.lamp === 'waiting'

  // "Skip" on the fix of main is only for the session the chain waits on.
  if (talking === null && (!block.open || fix)) return null
  return (
    <>
      <div className="panel__actions">
        {talking !== null && (
          <button
            type="button"
            className={`button button--primary${waiting ? ' panel__chat--waiting' : ''}`}
            title={aside ? t.session.chat.aside : waiting ? t.session.chat.waiting : t.session.chat.idle}
            onClick={() => setChatting(true)}
          >
            {t.session.chat.open}
          </button>
        )}
        {block.open && live !== null && (
          <button
            type="button"
            className="button"
            disabled={sending || midTurn || starting}
            aria-busy={replacing.on ? true : undefined}
            title={t.session.restartTitle}
            onClick={async () => {
              if (await send('chain/restart', body)) replacing.begin()
            }}
          >
            {t.session.restart}
          </button>
        )}
        {block.open &&
          (block.skipped ? (
            <button
              type="button"
              className="button"
              disabled={sending}
              title={t.session.skippedTitle}
              onClick={() => void send('chain/unskip', body)}
            >
              {t.common.restore}
            </button>
          ) : (
            <button
              type="button"
              className="button"
              disabled={sending || midTurn || starting}
              title={fix ? t.session.skipFix : block.current ? t.session.skipCurrent : t.session.skipOther}
              onClick={() => void send('chain/skip', body)}
            >
              {t.session.skip}
            </button>
          ))}
        {midTurn && !starting && <span className="panel__hint">{t.session.midTurn}</span>}
      </div>
      {remoteOff !== null && !starting && (
        <p className="panel__remote-off" title={session?.account == null ? undefined : t.session.account(session.account)}>
          {remoteOff}
        </p>
      )}
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      {chatting && talking !== null && (
        <Suspense fallback={null}>
          <TranscriptWindow
            key={talking.sessionId}
            sessionId={talking.sessionId}
            account={talking.account}
            live={talking.lamp !== 'finished'}
            chat={{ project: body.project, task: body.task, session: talking, aside }}
            onClose={() => setChatting(false)}
          />
        </Suspense>
      )}
    </>
  )
}

function SessionBody({ session, limit, scale, whole }: { session: SessionView; limit: LimitHold | null; scale: ContextScale; whole: boolean }) {
  const now = useNow(1_000)
  // A plain AskUserQuestion is not an alarm: the chat window shows it and the lamp says the session waits for a reply.
  const waits = session.waitingFor !== null && !session.asking
  const note =
    session.apiError ??
    (waits ? t.session.waits(session.waitingFor!) : session.startupDialog !== null ? t.session.startupDialog(session.startupDialog) : null)

  return (
    <>
      {note !== null && <p className="notice notice--error">{note}</p>}
      {limit !== null && <p className="notice notice--warn">{limitPlan(limit, now, session.remoteOff === 'api-key')}</p>}
      <dl className="panel__facts">
        <div className="panel__fact">
          <dt>{t.session.session}</dt>
          <dd className={`panel__state panel__state--${session.lamp}`}>{t.lamp[session.lamp]}</dd>
        </div>
        <div className="panel__fact">
          <dt>{t.session.time}</dt>
          <dd className="panel__value">{formatClock(sessionElapsed(session, now))}</dd>
          <dd className="panel__sub">
            {t.time.since} <time dateTime={session.startedAt}>{STARTED().format(new Date(session.startedAt))}</time>
          </dd>
        </div>
        <div className={`panel__fact panel__fact--${cacheTone(session.cache, now, session.lamp)}`}>
          <dt>{t.session.cache}</dt>
          {session.cache === null ? <dd className="panel__value">—</dd> : <CacheFact cache={session.cache} />}
        </div>
        <div className={`panel__fact panel__fact--wide panel__fact--${contextFill(session.contextTokens, scale).level}`}>
          <dt>{t.session.context}</dt>
          <dd>
            <ContextMeter tokens={session.contextTokens} scale={scale} full />
          </dd>
        </div>
        <TokensFact tokens={session.tokens} />
      </dl>
      {session.lamp === 'finished' ? (
        <RecordFeed sessionId={session.sessionId} account={session.account} whole={whole} />
      ) : (
        <Feed lines={session.feed} sessionId={session.sessionId} account={session.account} live whole={whole} />
      )}
    </>
  )
}

function RecordFeed({ sessionId, account, whole }: { sessionId: string; account: string | null; whole: boolean }) {
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

  return lines === null ? <p className="placeholder">{t.common.reading}</p> : <Feed lines={lines} sessionId={sessionId} account={account} live={false} whole={whole} />
}

function CacheFact({ cache }: { cache: CacheWindow }) {
  return (
    <>
      <dd className="panel__value">
        <CacheClock cache={cache} bare />
      </dd>
      <dd className="panel__sub">{t.session.ttl(t.cache.ttl[cache.ttl])}</dd>
    </>
  )
}

/** The total alone; the split by kind is a tip under it, opened by pointing at the number or pressing it. */
function TokensFact({ tokens }: { tokens: TokenTotals }) {
  const { shown, anchor, tip, show, hide, close } = useTip<HTMLButtonElement, HTMLSpanElement>()
  const parts: [string, number][] = [
    [t.session.input, tokens.input],
    [t.session.output, tokens.output],
    [t.session.cacheRead, tokens.cacheRead],
    [t.session.cacheWrite, tokens.cacheWrite],
  ]
  return (
    <div className="panel__fact panel__fact--wide panel__tokens">
      <dt>{t.session.tokens}</dt>
      <dd className="panel__value">
        <button
          ref={anchor}
          type="button"
          className="panel__total"
          aria-expanded={shown}
          onMouseEnter={show}
          onMouseLeave={hide}
          onFocus={show}
          onBlur={hide}
          onClick={show}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !shown) return
            event.preventDefault()
            event.stopPropagation()
            close()
          }}
        >
          {formatTokens(tokenTotal(tokens))}
          {shown && (
            <span ref={tip} popover="manual" className="panel__split" role="tooltip">
              {parts.map(([label, value]) => (
                <span key={label} className="panel__part">
                  <span className="panel__part-label">{label}</span>
                  <b>{formatTokens(value)}</b>
                </span>
              ))}
            </span>
          )}
        </button>
      </dd>
    </div>
  )
}

// A session on an API key is held only by its key's credit: the service checks it and goes on once it is back.
function limitPlan(hold: LimitHold, now: Date, apiKey: boolean): string {
  if (hold.resetsAt === null) return apiKey ? t.session.creditOut : t.session.limitUnknown
  const at = formatMoment(hold.resetsAt, now)
  return hold.then === 'resume' ? t.session.limitResume(at) : t.session.limitRelay(at)
}

interface SessionListProps {
  rows: TaskSession[]
  current: string | null
  onOpen: (row: TaskSession) => void
}

function SessionList({ rows, current, onOpen }: SessionListProps) {
  const handoffs = checkpointHandoffs(rows)
  return (
    <section className="panel__sessions" aria-label={t.session.list}>
      <h3 className="panel__feed-title">
        {t.session.list}
        {handoffs > 0 && t.session.handoffs(handoffs)}
      </h3>
      <ul className="sessions">
        {rows.map((row) => (
          <li key={row.sessionId}>
            <button type="button" className="sessions__row" onClick={() => onOpen(row)}>
              <time className="sessions__time" dateTime={row.at}>
                {STARTED().format(new Date(row.at))}
              </time>
              <span className="sessions__how">
                {t.session.launches[row.how]}
                {row.resumed > 0 && t.session.resumed(row.resumed)}
                {row.answers > 0 && t.session.answered(row.answers)}
                {row.left !== undefined && ` · ${leftText(row.left)}`}
                {row.replaced !== undefined && ` · ${t.session.replaced[row.replaced.how]}`}
              </span>
              <span className="sessions__account">
                <AccountTag email={row.account} />
              </span>
              <span className="sessions__id">{row.sessionId.slice(0, 8)}</span>
              {row.sessionId === current && <span className="sessions__now">{t.session.current}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function leftText(left: NonNullable<TaskSession['left']>): string {
  return left.reason === 'skip' ? t.session.skipped : t.session.postponed(left.blockers.join(', '))
}

function SessionWindow({ row, live, scale, onClose }: { row: TaskSession; live: boolean; scale: ContextScale; onClose: () => void }) {
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
  const account = record?.account ?? row.account ?? null

  return (
    <dialog
      ref={dialogRef}
      className="session-window"
      aria-label={t.session.dialog(row.sessionId.slice(0, 8))}
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
            <span className="panel__title">{t.session.launches[row.how]}</span>
            <AccountTag email={account} />
          </h2>
          <button type="button" className="panel__close" aria-label={t.session.closeDialog} onClick={() => dialogRef.current?.close()}>
            ×
          </button>
        </header>
        {error !== null && <p className="notice notice--error">{error}</p>}
        {error === null && record === undefined && <p className="placeholder">{t.common.reading}</p>}
        {record === null && <p className="placeholder">{t.session.notFound}</p>}
        {record !== null && record !== undefined && (
          <>
            <dl className="panel__facts">
              <div className="panel__fact">
                <dt>{t.session.started}</dt>
                <dd className="panel__value">
                  <time dateTime={started}>{STARTED().format(new Date(started))}</time>
                </dd>
              </div>
              <div className="panel__fact">
                <dt>{t.session.lastTurn}</dt>
                <dd className="panel__value">{last === null ? '—' : <time dateTime={last}>{STARTED().format(new Date(last))}</time>}</dd>
              </div>
              <div className="panel__fact">
                <dt>{t.session.worked}</dt>
                <dd className="panel__value">{last === null ? '—' : formatClock(Date.parse(last) - Date.parse(started))}</dd>
              </div>
              <div className="panel__fact panel__fact--wide">
                <dt>{t.session.endContext}</dt>
                <dd>
                  <ContextMeter tokens={record.contextTokens} scale={scale} full />
                </dd>
              </div>
              <TokensFact tokens={record.tokens} />
              {(record.branch !== null || record.workdir !== null) && (
                <div className="panel__fact panel__fact--wide">
                  <dt>{t.session.place}</dt>
                  <dd className="session-window__place">
                    {record.branch ?? '—'} · {record.workdir ?? '—'}
                  </dd>
                </div>
              )}
            </dl>
            {record.apiError !== null && <p className="notice notice--error">{record.apiError}</p>}
            <Feed lines={record.feed} sessionId={row.sessionId} account={account} live={live} whole />
          </>
        )}
      </div>
    </dialog>
  )
}

interface FeedProps {
  lines: FeedLine[]
  sessionId: string
  account: string | null
  live: boolean
  /** Offers the read-only whole transcript; the current session has the chat window instead. */
  whole: boolean
}

function Feed({ lines, sessionId, account, live, whole: offered }: FeedProps) {
  const listRef = useRef<HTMLOListElement>(null)
  const pinned = useRef(true)
  const [whole, setWhole] = useState(false)

  useLayoutEffect(() => {
    const list = listRef.current
    if (list !== null && pinned.current) list.scrollTop = list.scrollHeight
  }, [lines])

  const onScroll = () => {
    const list = listRef.current
    if (list !== null) pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight < PINNED_SLACK
  }

  return (
    <section className="panel__feed" aria-label={t.session.feed}>
      <div className="panel__feed-head">
        <h3 className="panel__feed-title">{t.session.feed}</h3>
        {offered && (
          <button type="button" className="panel__feed-open" onClick={() => setWhole(true)}>
            {t.session.transcript}
          </button>
        )}
      </div>
      {whole && (
        <Suspense fallback={null}>
          <TranscriptWindow sessionId={sessionId} account={account} live={live} onClose={() => setWhole(false)} />
        </Suspense>
      )}
      {lines.length === 0 ? (
        <p className="placeholder">{t.session.feedEmpty}</p>
      ) : (
        <ol ref={listRef} className="feed" onScroll={onScroll}>
          {lines.map((line, index) => (
            <li key={`${line.at}-${index}`} className={`feed__line feed__line--${line.kind}`}>
              <time className="feed__time" dateTime={line.at}>
                {line.at === '' ? '' : FEED_TIME().format(new Date(line.at))}
              </time>
              <span className="feed__text">{line.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
