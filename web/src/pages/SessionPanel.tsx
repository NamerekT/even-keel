import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { fixTaskOf, isCarryName, isFixName, isOwnName } from '../../../src/chain/fix.js'
import { CLAUDE } from '../../../src/claude/name.js'
import type { TaskSession } from '../../../src/chain/launches.js'
import type { LimitHold } from '../../../src/chain/relay.js'
import type { CacheWindow, FeedLine, TokenTotals } from '../../../src/sessions/transcript.js'
import { TURN_HANG_MS, TURN_RESTART_MS, shownSilence, type SilentRestart } from '../../../src/sessions/silence.js'
import type { ContextScale, SessionRecord, SessionView } from '../../../src/state.js'
import type { Notice } from '../../../src/notice/notice.js'
import { formatClock, formatMoment, formatQuiet, formatTokens } from '../format.js'
import { localized, say, t } from '../i18n/index.js'
import { agentLabel } from '../accountName.js'
import { completionTasks, needsReply } from '../completion.js'
import { useNow } from '../layout/useNow.js'
import { useNarrow } from '../layout/useNarrow.js'
import { useLive } from '../live/context.js'
import { useCommand, useHold } from '../live/useCommand.js'
import { cacheTone, contextFill, contextResets, sessionElapsed, taskProject, tokenTotal, type ChainBlock } from '../state.js'
import { AccountTag } from '../ui/AccountTag.js'
import { Band, Fact, FactList, SectionLabel } from '../ui/blocks.js'
import { CacheClock } from '../ui/CacheClock.js'
import { ContextMeter } from '../ui/ContextMeter.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { PipelineIcon } from '../ui/icons.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { Lamp } from '../ui/Lamp.js'
import { PullButton } from '../ui/PullChip.js'
import { StartCard } from '../ui/SessionStart.js'
import { Tipped } from '../ui/Tipped.js'
import { useTip } from '../ui/useTip.js'
import { WorkChip } from '../ui/WorkChip.js'
import { ciHash } from './CiChip.js'
import { feedText } from './feedLine.js'
import { sessionStatus } from './sessionStatus.js'
import { LimitNotice } from './LimitNotice.js'
import { NoticeFixButton } from './FixButtons.js'
import type { LimitRefusal } from './limitMessages.js'
import './facts.css'

const TranscriptWindow = lazy(async () => ({ default: (await import('./TranscriptWindow.js')).TranscriptWindow }))

const STARTED = localized((language) => new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))
const FEED_TIME = localized((language) => new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
const PINNED_SLACK = 24
const REPLACE_WAIT_MS = 90_000

interface Props {
  block: ChainBlock
  scale: ContextScale
  /** The project has a CI: a fix of main offers its runs. */
  ci: boolean
  onCard: (task: string) => void
  onClose: () => void
}

export function SessionPanel({ block, scale, ci, onCard, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const [opened, setOpened] = useState<TaskSession | null>(null)
  const [refusal, setRefusal] = useState<(LimitRefusal & { sessionId: string | undefined }) | null>(null)
  const sessionId = block.session?.sessionId
  const onFailure = useCallback((failure: Notice | null) => {
    setRefusal(failure?.code === 'chain.limitSpent' ? { notice: failure, at: new Date().toISOString(), sessionId } : null)
  }, [sessionId])
  const recovered = block.session?.lamp === 'working' || block.session?.lamp === 'finished'
  useEffect(() => {
    if (recovered) setRefusal(null)
  }, [recovered])
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
        <Lamp lamp={block.lamp} label={block.lamp === 'waiting' && block.session?.apiErrorKind === 'transient' ? sessionStatus(block.session) : undefined} />
        <h2 className="panel__task">
          {isOwnName(block.id) ? (
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
      {(block.skipped || block.interrupted || block.work !== undefined) && (
        <p className="panel__status">
          {block.skipped && <span className="panel__flag">{t.session.skipped}</span>}
          {block.interrupted && <span className="panel__flag">{t.session.interrupted}</span>}
          {block.work !== undefined && <WorkChip work={block.work} leftovers={block.leftovers} />}
        </p>
      )}
      <Actions block={block} scale={scale} ci={ci} onFailure={onFailure} />
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
        <SessionBody session={block.session} limit={block.limit} refusal={!recovered && refusal?.sessionId === sessionId ? refusal : null} scale={scale} whole={!chat} />
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

function Actions({ block, scale, ci, onFailure }: { block: ChainBlock; scale: ContextScale; ci: boolean; onFailure: (failure: Notice | null) => void }) {
  const { send, sending, failure } = useCommand()
  const lastFailure = useRef(failure)
  useEffect(() => {
    if (lastFailure.current === failure) return
    lastFailure.current = failure
    onFailure(failure)
  }, [failure, onFailure])
  const { state } = useLive()
  const [chatting, setChatting] = useState(false)
  const [confirmation, setConfirmation] = useState<SilentRestart | null>(null)
  const now = useNow(1_000)
  const fix = isOwnName(block.id)
  // The row of a fix or a carry is one of its episodes; the service knows it by its name.
  const body = { project: taskProject(state, block.id), task: fix ? fixTaskOf(block.id) : block.id }
  const session = block.session
  const live = block.current ? session : null
  // A task that made way for the fix of main keeps its chat, shut until the chain takes it again.
  const aside = block.aside === true
  // Once the chain stopped, the session that lives on is still answered from the chat.
  const talking = live ?? (aside || block.loose === true ? session : null)
  // A reply stops the session and resumes it: for those seconds it is gone from the state, the open chat stays on its last view.
  const lastTalking = useRef(talking)
  if (talking !== null) lastTalking.current = talking
  const chatSession = talking ?? (chatting ? lastTalking.current : null)
  const midTurn = live !== null && (live.lamp === 'working' || live.waitingFor !== null)
  const quietSince = live === null ? null : shownSilence(live.lamp, live.waitingFor, live.silentSince, now.getTime())
  const quietAt = quietSince === null ? null : Date.parse(quietSince)
  const earlyRestart = quietAt !== null && now.getTime() - quietAt >= TURN_RESTART_MS
  const quietText = quietAt === null ? null : t.session.silent(
    formatQuiet(now.getTime() - quietAt),
    formatMoment(new Date(quietAt + TURN_RESTART_MS).toISOString(), now),
    formatMoment(new Date(quietAt + TURN_HANG_MS).toISOString(), now),
  )
  const remoteOff = session === null || session.remoteUrl !== null ? null : t.session.remote[session.remoteOff ?? 'no-bridge']
  const replacing = useHold(`${block.current}|${session?.sessionId ?? ''}`, REPLACE_WAIT_MS)
  const starting = replacing.on || (block.current && block.start !== null)
  const waiting = !aside && talking?.lamp === 'waiting' && (!completionTasks(state).has(talking.task) || needsReply(talking))
  // Why "New session" and "Skip" cannot be pressed now and when they can, for their tips.
  const wait =
    replacing.on || block.start?.phase === 'handover'
      ? t.session.held.replacing
      : starting
        ? t.session.held.launching
        : midTurn
          ? t.session.held.midTurn
          : null
  const restartHeld =
    (earlyRestart && !starting ? null : midTurn && quietText !== null && !starting ? quietText : wait) ??
    (block.skipped ? t.session.held.skipped : !block.current ? t.session.held.notCurrent : live === null ? t.session.held.noSession : null)

  // The runs of the commits a fix of main went from and landed, beside its chat.
  const runs = isFixName(block.id) && ci && block.fix !== undefined

  // "Skip" on the fix of main is only for the session the chain waits on.
  if (chatSession === null && (!block.open || fix) && block.review === undefined && !runs) return null
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
        {block.review !== undefined && <PullButton review={block.review} />}
        {runs && (
          <Link to={{ hash: ciHash(block.id) }} className="button pull-button__link" title={t.chain.fixRuns}>
            <PipelineIcon />
            {t.ci.chip}
          </Link>
        )}
        {block.open && (
          <PanelButton
            tip={earlyRestart ? quietText! : t.session.restartTitle}
            held={restartHeld}
            sending={sending}
            busy={replacing.on}
            onClick={async () => {
              if (earlyRestart && quietSince !== null && live !== null) {
                setConfirmation({ sessionId: live.sessionId, since: quietSince })
                return
              }
              if (await send('chain/restart', body)) replacing.begin()
            }}
          >
            {t.session.restart}
          </PanelButton>
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
            <PanelButton
              tip={isCarryName(block.id) ? t.session.skipCarry : fix ? t.session.skipFix : block.current ? t.session.skipCurrent : t.session.skipOther}
              held={wait}
              sending={sending}
              onClick={() => void send('chain/skip', body)}
            >
              {t.session.skip}
            </PanelButton>
          ))}
      </div>
      {quietText !== null && !starting && <Band tone="warn" className="panel__quiet">{quietText}</Band>}
      {confirmation !== null && (
        <ConfirmDialog
          title={t.session.restart}
          question={t.session.confirmSilent(formatMoment(confirmation.since, now))}
          confirm={t.session.interruptRestart}
          cancel={t.common.cancel}
          busy={sending}
          onClose={() => setConfirmation(null)}
          onConfirm={() => {
            void send('chain/restart', { ...body, confirmed: confirmation }).then((ok) => {
              setConfirmation(null)
              if (ok) replacing.begin()
            })
          }}
        />
      )}
      {remoteOff !== null && !starting && (
        <p className="panel__remote-off" title={session?.account == null ? undefined : t.session.account(session.account)}>
          {remoteOff}
        </p>
      )}
      {failure !== null && failure.code !== 'chain.limitSpent' && <p className="notice notice--error">{say(failure)}</p>}
      {chatting && chatSession !== null && (
        <Suspense fallback={null}>
          <TranscriptWindow
            key={chatSession.sessionId}
            sessionId={chatSession.sessionId}
            account={chatSession.account}
            live={chatSession.lamp !== 'finished' || talking === null}
            chat={{
              project: body.project,
              task: body.task,
              session: chatSession,
              aside,
              scale,
              answeredAt: block.answering ?? block.sessions.find((run) => run.sessionId === chatSession.sessionId)?.answeredAt ?? null,
              delivering: block.answering !== undefined,
              mail: state?.mailbox[chatSession.sessionId],
              review: block.review,
            }}
            onClose={() => setChatting(false)}
          />
        </Suspense>
      )}
    </>
  )
}

function SessionBody({ session, limit, refusal = null, scale, whole }: { session: SessionView; limit: LimitHold | null; refusal?: LimitRefusal | null; scale: ContextScale; whole: boolean }) {
  const now = useNow(1_000)
  const { state } = useLive()
  const narrow = useNarrow()
  const chainShowsRefusal = !narrow && session.apiErrorNotice?.code === 'chain.modelUnavailable' && state?.chain.active.some(chain => chain.current?.sessionId === session.sessionId && chain.error?.code === 'chain.modelUnavailable')
  const refused = completionTasks(state).has(session.task) && !needsReply(session)
  // A plain AskUserQuestion is not an alarm: the chat window shows it and the lamp says the session waits for a reply.
  const waits = session.waitingFor !== null && !session.asking
  const limited = limit !== null || refusal !== null || ['limit', 'credit', 'spend'].includes(session.apiErrorKind ?? '')
  const note =
    (session.apiErrorNotice === undefined ? session.apiError : say(session.apiErrorNotice)) ??
    (waits
      ? t.session.waits(session.waitingFor!)
      : session.startupDialog !== null
        ? t.session.startupDialog(session.startupDialog)
        : session.hungSince !== null
          ? t.session.hung(formatMoment(session.hungSince, now))
          : null)

  return (
    <>
      {note !== null && !limited && !chainShowsRefusal && (session.apiErrorNotice === undefined
        ? <p className={`notice notice--${session.apiErrorKind === 'transient' || session.apiErrorKind === 'model' ? 'warn' : 'error'}`}>{note}</p>
        : <Band tone={session.apiErrorKind === 'transient' || session.apiErrorKind === 'model' ? 'warn' : 'error'} action={<NoticeFixButton project={taskProject(state, session.task)} notice={session.apiErrorNotice} />}>{note}</Band>)}
      <LimitNotice active={limited} session={session} hold={limit} refusal={refusal} />
      <FactList>
        <Fact label={t.session.session}>
          <dd className={`panel__state panel__state--${refused ? 'error' : session.lamp}`}>{sessionStatus(session, refused)}</dd>
        </Fact>
        <Fact label={t.session.time}>
          <TipValue value={formatClock(sessionElapsed(session, now, limited))}>
            <span className="panel__part">
              <span className="panel__part-label">{t.session.startedAt}</span>
              <b>
                <time dateTime={session.startedAt}>{STARTED().format(new Date(session.startedAt))}</time>
              </b>
            </span>
          </TipValue>
        </Fact>
        <Fact label={t.session.cache} tone={cacheTone(session.cache, now, session.lamp)}>
          {session.cache === null ? <dd className="panel__value">—</dd> : <CacheFact cache={session.cache} />}
        </Fact>
        <Fact label={t.session.context} wide tone={contextFill(session.contextTokens, scale, session.contextWindow).level}>
          <dd>
            <ContextMeter tokens={session.contextTokens} window={session.contextWindow} scale={scale} full />
          </dd>
        </Fact>
        <ModelFact agent={session.agent} model={session.model} />
        <TokensFact tokens={session.tokens} wide={false} />
      </FactList>
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
    <TipValue value={<CacheClock cache={cache} bare />}>
      <span className="panel__part">
        <span className="panel__part-label">{t.session.lifetime}</span>
        <b>{t.cache.ttl[cache.ttl]}</b>
      </span>
    </TipValue>
  )
}

/** The model the session answers with; the provider beside it when not Claude. */
function ModelFact({ agent, model }: { agent: string; model: string | null }) {
  const provider = agentLabel(agent)
  const value = model === null ? '—' : agent === CLAUDE ? model : `${provider} · ${model}`
  return (
    <Fact label={t.session.model} className="panel__inline panel__model">
      <TipValue value={value}>
        <span className="panel__part">
          <span className="panel__part-label">{t.session.provider}</span>
          <b>{provider}</b>
        </span>
        {model !== null && (
          <span className="panel__part">
            <span className="panel__part-label">{t.session.modelOf}</span>
            <b>{model}</b>
          </span>
        )}
        <span className="panel__tip-note">{model === null ? t.session.modelYet : t.session.modelFrom}</span>
      </TipValue>
    </Fact>
  )
}

/** The total alone; the split by kind is a tip under it, opened by pointing at the number or pressing it. */
function TokensFact({ tokens, wide = true }: { tokens: TokenTotals; wide?: boolean }) {
  const parts: [string, number][] = [
    [t.session.input, tokens.input],
    [t.session.output, tokens.output],
    [t.session.cacheRead, tokens.cacheRead],
    [t.session.cacheWrite, tokens.cacheWrite],
  ]
  return (
    <Fact label={t.session.tokens} wide={wide} className="panel__inline">
      <TipValue value={formatTokens(tokenTotal(tokens))}>
        {parts.map(([label, value]) => (
          <span key={label} className="panel__part">
            <span className="panel__part-label">{label}</span>
            <b>{formatTokens(value)}</b>
          </span>
        ))}
      </TipValue>
    </Fact>
  )
}

/** A fact's value whose details are a tip under it, opened by pointing at the value or pressing it. */
function TipValue({ value, children }: { value: ReactNode; children: ReactNode }) {
  const { shown, anchor, tip, show, point, hide, close } = useTip<HTMLButtonElement, HTMLSpanElement>()
  return (
    <dd className="panel__value">
      <button
        ref={anchor}
        type="button"
        className="panel__total"
        aria-expanded={shown}
        onMouseEnter={point}
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
        {value}
        {shown && (
          <span ref={tip} popover="manual" className="panel__split" role="tooltip">
            {children}
          </span>
        )}
      </button>
    </dd>
  )
}

interface PanelButtonProps {
  tip: string
  /** Why the button cannot be pressed now and when it can; `null` — it can. */
  held: string | null
  sending: boolean
  busy?: boolean
  onClick: () => void
  children: ReactNode
}

/** A panel action with a tip: what it does, or, greyed, why it waits — `aria-disabled` keeps the tip reachable. */
function PanelButton({ tip, held, sending, busy = false, onClick, children }: PanelButtonProps) {
  return (
    <Tipped tip={held ?? tip} align="start">
      <button
        type="button"
        className="button"
        disabled={sending}
        aria-disabled={held !== null ? true : undefined}
        aria-busy={busy ? true : undefined}
        onClick={held === null ? onClick : undefined}
      >
        {children}
      </button>
    </Tipped>
  )
}

interface SessionListProps {
  rows: TaskSession[]
  current: string | null
  onOpen: (row: TaskSession) => void
}

function SessionList({ rows, current, onOpen }: SessionListProps) {
  const resets = contextResets(rows)
  return (
    <section className="panel__sessions" aria-label={t.session.list}>
      <SectionLabel>
        {t.session.list}
        {resets.total > 0 && t.session.resets(resets.total, t.chain.resetsOf(resets))}
      </SectionLabel>
      <ul className="sessions">
        {rows.map((row) => (
          <li key={row.sessionId}>
            <button type="button" className="sessions__row" onClick={() => onOpen(row)}>
              <time className="sessions__time" dateTime={row.at}>
                {STARTED().format(new Date(row.at))}
              </time>
              <span className="sessions__how">
                {launchText(row)}
                {row.resumed > 0 && t.session.resumed(row.resumed)}
                {row.answers > 0 && t.session.answered(row.answers)}
                {row.compactions !== undefined && t.session.compacted(row.compactions)}
                {row.left !== undefined && ` · ${leftText(row.left)}`}
                {row.replaced !== undefined && ` · ${replacedText(row.replaced)}`}
              </span>
              <span className="sessions__account">
                <AccountTag account={row.account} />
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

function launchText(row: TaskSession): string {
  return row.how === 'relay' ? t.session.relayed[row.cause ?? 'limit'] : t.session.launches[row.how]
}

function replacedText(replaced: NonNullable<TaskSession['replaced']>): string {
  return replaced.how === 'relay' ? t.session.replacedRelay[replaced.cause ?? 'limit'] : t.session.replaced[replaced.how]
}

function leftText(left: NonNullable<TaskSession['left']>): string {
  return left.reason === 'skip' ? t.session.skipped : t.session.postponed(left.blockers.join(', '))
}

function SessionWindow({ row, live, scale, onClose }: { row: TaskSession; live: boolean; scale: ContextScale; onClose: () => void }) {
  const { session } = useLive()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialogRef, () => dialogRef.current?.close())
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
      {...backdrop}
    >
      <div className="session-window__body">
        <header className="panel__head">
          <h2 className="panel__task">
            <span className="panel__key">{row.sessionId.slice(0, 8)}</span>
            <span className="panel__title">{launchText(row)}</span>
            <AccountTag account={account} />
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
            <FactList>
              <Fact label={t.session.started}>
                <dd className="panel__value">
                  <time dateTime={started}>{STARTED().format(new Date(started))}</time>
                </dd>
              </Fact>
              <Fact label={t.session.lastTurn}>
                <dd className="panel__value">{last === null ? '—' : <time dateTime={last}>{STARTED().format(new Date(last))}</time>}</dd>
              </Fact>
              <Fact label={t.session.worked}>
                <dd className="panel__value">{last === null ? '—' : formatClock(Date.parse(last) - Date.parse(started))}</dd>
              </Fact>
              <Fact label={t.session.endContext} wide>
                <dd>
                  <ContextMeter tokens={record.contextTokens} window={record.contextWindow} scale={scale} full />
                </dd>
              </Fact>
              <TokensFact tokens={record.tokens} />
              {(record.branch !== null || record.workdir !== null) && (
                <Fact label={t.session.place} wide>
                  <dd className="session-window__place">
                    {record.branch ?? '—'} · {record.workdir ?? '—'}
                  </dd>
                </Fact>
              )}
            </FactList>
            {record.apiError !== null && <p className="notice notice--error">{record.apiErrorNotice === undefined ? record.apiError : say(record.apiErrorNotice)}</p>}
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
        <SectionLabel>{t.session.feed}</SectionLabel>
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
              <span className="feed__text">{feedText(line)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
