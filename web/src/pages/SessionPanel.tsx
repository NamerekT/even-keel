import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { fixTaskOf, isCarryName, isFixName, isOwnName } from '../../../src/chain/fix.js'
import type { TaskSession } from '../../../src/chain/launches.js'
import type { LimitHold } from '../../../src/chain/relay.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import { TURN_HANG_MS, TURN_RESTART_MS, shownSilence, type SilentRestart } from '../../../src/sessions/silence.js'
import type { ContextScale, SessionRecord, SessionView } from '../../../src/state.js'
import type { Notice } from '../../../src/notice/notice.js'
import { formatClock, formatFullTime, formatLineTime, formatMoment, formatQuiet, formatStamp, minuteMarks } from '../format.js'
import { localized, say, t } from '../i18n/index.js'
import { completionTasks, needsReply } from '../completion.js'
import { useNow } from '../layout/useNow.js'
import { useNarrow } from '../layout/useNarrow.js'
import { useLive } from '../live/context.js'
import { useCommand, useHold } from '../live/useCommand.js'
import { cacheTone, sessionElapsed, taskProject, type ChainBlock } from '../state.js'
import { AccountTag } from '../ui/AccountTag.js'
import { Band, Fact, FactList, SectionLabel } from '../ui/blocks.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { PipelineIcon } from '../ui/icons.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { PullButton } from '../ui/PullChip.js'
import { StartCard } from '../ui/SessionStart.js'
import { Tipped } from '../ui/Tipped.js'
import { WorkChip } from '../ui/WorkChip.js'
import { Loading } from '../ui/Loader.js'
import { offersAccept } from './acceptAnswer.js'
import { ciHash } from './CiChip.js'
import { feedText } from './feedLine.js'
import { backgroundTip, sessionStatus } from './sessionStatus.js'
import { LimitNotice } from './LimitNotice.js'
import { NoticeFixButton } from './FixButtons.js'
import type { LimitRefusal } from './limitMessages.js'
import { CacheFact, ContextFact, ModelFact, TipValue, TokensFact } from './SessionFacts.js'
import './facts.css'

import type { WindowTask } from './TranscriptWindow.js'

const TranscriptWindow = lazy(async () => ({ default: (await import('./TranscriptWindow.js')).TranscriptWindow }))

const STARTED = localized((language) => new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))
const PINNED_SLACK = 24
const REPLACE_WAIT_MS = 90_000

interface Props {
  block: ChainBlock
  scale: ContextScale
  /** The project has a CI: a fix of main offers its runs. */
  ci: boolean
  onCard: (task: string) => void
  onClose: () => void
  /** The task's chat window opened or closed: the page keeps the panel on a task that closes under an open chat. */
  onChatting?: (open: boolean) => void
}

export function SessionPanel({ block, scale, ci, onCard, onClose, onChatting }: Props) {
  const { state } = useLive()
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
  const [chatting, setChat] = useState(false)
  const setChatting = (open: boolean) => {
    setChat(open)
    onChatting?.(open)
  }
  const chatClosed = useRef(onChatting)
  chatClosed.current = onChatting
  useEffect(() => () => chatClosed.current?.(false), [])
  // A press on the feed opens what the panel answers the session in: the chat, else the whole transcript with the field shut.
  const openChat = chat ? () => setChatting(true) : undefined
  // The session windows name the task as this panel's head does, and share its draft.
  const windowTask: WindowTask = { key: block.id, title: block.title, project: taskProject(state, block.id), closed: !block.open }

  useEffect(() => closeRef.current?.focus({ preventScroll: true }), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Escape in a dialog over the panel — the task card opened from the chat — closes only that dialog.
      if (event.target instanceof Element && event.target.closest('dialog[open]') !== null) return
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside className="panel" aria-label={t.session.panel(block.id)}>
      <header className="panel__head">
        {/* No lamp: the row beside the panel shows it, and the Session fact says the same in words. */}
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
      {/* A skipped task has no flag here: its Restore button says so in its tip. */}
      {(block.interrupted || block.work !== undefined) && (
        <p className="panel__status">
          {block.interrupted && <span className="panel__flag">{t.session.interrupted}</span>}
          {block.work !== undefined && <WorkChip work={block.work} leftovers={block.leftovers} />}
        </p>
      )}
      <Actions block={block} task={windowTask} scale={scale} ci={ci} chatting={chatting} onChat={setChatting} onCard={onCard} onFailure={onFailure} />
      {block.start !== null ? (
        <>
          <StartCard start={block.start} />
          {block.start.phase === 'answer' && block.session !== null && (
            <Feed lines={block.session.feed} sessionId={block.session.sessionId} account={block.session.account} live task={windowTask} onChat={openChat} />
          )}
        </>
      ) : block.session === null ? (
        <p className="placeholder">{block.sessions.length === 0 ? t.session.none : t.session.noneNow}</p>
      ) : (
        <SessionBody session={block.session} limit={block.limit} refusal={!recovered && refusal?.sessionId === sessionId ? refusal : null} scale={scale} task={windowTask} onChat={openChat} />
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
          task={windowTask}
          onClose={() => setOpened(null)}
        />
      )}
    </aside>
  )
}

interface ActionsProps {
  block: ChainBlock
  /** The chat window's task: its head, its draft, and whether it is closed. */
  task: WindowTask
  scale: ContextScale
  ci: boolean
  /** The chat window is open; the panel keeps it, since a press on the feed opens it too. */
  chatting: boolean
  onChat: (open: boolean) => void
  /** Opens a task's card: the chat's task panel leads to it. */
  onCard: (task: string) => void
  onFailure: (failure: Notice | null) => void
}

function Actions({ block, task, scale, ci, chatting, onChat: setChatting, onCard, onFailure }: ActionsProps) {
  const { send, sending, failure } = useCommand()
  const lastFailure = useRef(failure)
  useEffect(() => {
    if (lastFailure.current === failure) return
    lastFailure.current = failure
    onFailure(failure)
  }, [failure, onFailure])
  const { state } = useLive()
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
  // So does a handoff until the new session is up, and the task's close: the chat stays open on the last session, shut.
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

  const accepts =
    live !== null &&
    block.open &&
    !starting &&
    block.answering === undefined &&
    block.review === undefined &&
    offersAccept(live, block.id, state?.works[body.project]?.[block.id], completionTasks(state).has(live.task))

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
        {accepts && (
          <PanelButton tip={t.session.acceptTitle} held={null} sending={sending} onClick={() => void send('chain/accept', { ...body, sessionId: live.sessionId })}>
            {t.session.accept}
          </PanelButton>
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
            <PanelButton tip={t.session.skippedTitle} held={null} sending={sending} onClick={() => void send('chain/unskip', body)}>
              {t.common.restore}
            </PanelButton>
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
          {/* One window per task: a handoff swaps only its feed, without closing and opening it again. */}
          <TranscriptWindow
            sessionId={chatSession.sessionId}
            account={chatSession.account}
            live={block.open && (chatSession.lamp !== 'finished' || talking === null)}
            task={task}
            chat={{
              project: body.project,
              task: body.task,
              session: chatSession,
              aside,
              renews: live !== null,
              accepts,
              scale,
              answeredAt: block.answering ?? block.sessions.find((run) => run.sessionId === chatSession.sessionId)?.answeredAt ?? null,
              delivering: block.answering !== undefined,
              mail: state?.mailbox[chatSession.sessionId],
              review: block.review,
            }}
            onCard={onCard}
            onClose={() => setChatting(false)}
          />
        </Suspense>
      )}
    </>
  )
}

interface SessionBodyProps {
  session: SessionView
  limit: LimitHold | null
  refusal?: LimitRefusal | null
  scale: ContextScale
  task: WindowTask
  onChat: (() => void) | undefined
}

function SessionBody({ session, limit, refusal = null, scale, task, onChat }: SessionBodyProps) {
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
          {session.background != null && !refused ? (
            <TipValue className={`panel__state panel__state--${session.lamp}`} value={sessionStatus(session)}>
              {backgroundTip(session.background, now).split('\n').map((line) => <span key={line} className="panel__tip-note">{line}</span>)}
            </TipValue>
          ) : (
            <dd className={`panel__state panel__state--${refused ? 'error' : session.lamp}`}>{sessionStatus(session, refused)}</dd>
          )}
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
        <ContextFact label={t.session.context} tokens={session.contextTokens} window={session.contextWindow} scale={scale} wide />
        <ModelFact agent={session.agent} model={session.model} />
        <TokensFact tokens={session.tokens} />
      </FactList>
      {session.lamp === 'finished' ? (
        <RecordFeed sessionId={session.sessionId} account={session.account} task={task} onChat={onChat} />
      ) : (
        <Feed lines={session.feed} sessionId={session.sessionId} account={session.account} live task={task} onChat={onChat} />
      )}
    </>
  )
}

function RecordFeed({ sessionId, account, task, onChat }: { sessionId: string; account: string | null; task: WindowTask; onChat: (() => void) | undefined }) {
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

  return (
    <Loading busy={lines === null} label={t.common.reading}>
      {lines !== null && <Feed lines={lines} sessionId={sessionId} account={account} live={false} task={task} onChat={onChat} />}
    </Loading>
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
  const { state } = useLive()
  const now = useNow(60_000)
  return (
    <section className="panel__sessions" aria-label={t.session.list}>
      <SectionLabel>{t.session.list}</SectionLabel>
      <ul className="sessions">
        {rows.map((row) => (
          <li key={row.sessionId}>
            <button type="button" className="sessions__row" onClick={() => onOpen(row)}>
              <span className="sessions__meta">
                <Tipped inline align="start" className="sessions__seg sessions__time" tip={formatFullTime(row.at)}>
                  <time dateTime={row.at}>{formatStamp(row.at, now)}</time>
                </Tipped>
                <span className="sessions__seg sessions__account">
                  <AccountTag account={row.account} agent={state?.sessions.find((session) => session.sessionId === row.sessionId)?.agent} />
                </span>
                <span className="sessions__seg sessions__id">{row.sessionId.slice(0, 8)}</span>
                {row.sessionId === current && <span className="sessions__now">{t.session.current}</span>}
              </span>
              <span className="sessions__how">
                {launchText(row)}
                {row.resumed > 0 && t.session.resumed(row.resumed)}
                {row.answers > 0 && t.session.answered(row.answers)}
                {row.compactions !== undefined && t.session.compacted(row.compactions)}
                {row.left !== undefined && ` · ${leftText(row.left)}`}
                {row.replaced !== undefined && ` · ${replacedText(row.replaced)}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function launchText(row: TaskSession): string {
  return row.how === 'relay' || row.cause !== undefined ? t.session.relayed[row.cause ?? 'limit'] : t.session.launches[row.how]
}

function replacedText(replaced: NonNullable<TaskSession['replaced']>): string {
  return replaced.how === 'relay' || replaced.cause !== undefined ? t.session.replacedRelay[replaced.cause ?? 'limit'] : t.session.replaced[replaced.how]
}

function leftText(left: NonNullable<TaskSession['left']>): string {
  return left.reason === 'skip' ? t.session.skipped : t.session.postponed(left.blockers.join(', '))
}

function SessionWindow({ row, live, scale, task, onClose }: { row: TaskSession; live: boolean; scale: ContextScale; task: WindowTask; onClose: () => void }) {
  const { session, state } = useLive()
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
            <AccountTag account={account} agent={state?.sessions.find((session) => session.sessionId === row.sessionId)?.agent} />
          </h2>
          <button type="button" className="panel__close" aria-label={t.session.closeDialog} onClick={() => dialogRef.current?.close()}>
            ×
          </button>
        </header>
        {error !== null && <p className="notice notice--error">{error}</p>}
        <Loading busy={error === null && record === undefined} label={t.common.reading} fit="fill">
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
                <ContextFact label={t.session.endContext} tokens={record.contextTokens} window={record.contextWindow} scale={scale} />
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
              <Feed lines={record.feed} sessionId={row.sessionId} account={account} live={live} task={task} onChat={undefined} />
            </>
          )}
        </Loading>
      </div>
    </dialog>
  )
}

interface FeedProps {
  lines: FeedLine[]
  sessionId: string
  account: string | null
  live: boolean
  /** The task the read-only transcript names in its head. */
  task: WindowTask
  /** A press on the feed opens the chat of the current session; without it, the read-only whole transcript. */
  onChat: (() => void) | undefined
}

function Feed({ lines, sessionId, account, live, task, onChat }: FeedProps) {
  const listRef = useRef<HTMLOListElement>(null)
  const pinned = useRef(true)
  const [whole, setWhole] = useState(false)
  const open = onChat ?? (() => setWhole(true))
  const marks = minuteMarks(lines.map((line) => line.at))

  useLayoutEffect(() => {
    const list = listRef.current
    if (list !== null && pinned.current) list.scrollTop = list.scrollHeight
  }, [lines])

  const onScroll = () => {
    const list = listRef.current
    if (list !== null) pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight < PINNED_SLACK
  }

  // Selecting text in the feed is not a press on it.
  const onClick = () => {
    const selection = window.getSelection()
    if (selection !== null && !selection.isCollapsed && listRef.current?.contains(selection.anchorNode)) return
    open()
  }

  return (
    <section className="panel__feed" aria-label={t.session.feed}>
      {whole && (
        <Suspense fallback={null}>
          <TranscriptWindow sessionId={sessionId} account={account} live={live} task={task} onClose={() => setWhole(false)} />
        </Suspense>
      )}
      {lines.length === 0 ? (
        <p className="placeholder">{t.session.feedEmpty}</p>
      ) : (
        <ol
          ref={listRef}
          className="feed feed--open"
          tabIndex={0}
          aria-label={onChat === undefined ? t.session.feedOpens.transcript : t.session.feedOpens.chat}
          onScroll={onScroll}
          onClick={onClick}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
            event.preventDefault()
            open()
          }}
        >
          {lines.map((line, index) => (
            <li key={`${line.at}-${index}`} className={`feed__line feed__line--${line.kind}`}>
              <FeedTime at={line.at} shown={marks[index]!} />
              <span className="feed__text">{feedText(line)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/** A line's time, only where the minute changed; every line keeps the full moment in a tip on its time cell. */
function FeedTime({ at, shown }: { at: string; shown: boolean }) {
  if (at === '') return <span className="feed__time" />
  return (
    <Tipped inline align="start" className="feed__time" tip={formatFullTime(at)}>
      <time dateTime={at}>{shown ? formatLineTime(at) : ''}</time>
    </Tipped>
  )
}
