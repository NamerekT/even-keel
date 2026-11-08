import { useEffect, useId, useRef, useState } from 'react'
import type { AccountEntry, AccountView } from '../../../src/account/model.js'
import type { ContextScale, SessionRecord, SessionView } from '../../../src/state.js'
import { accountOf } from '../accountName.js'
import { formatTokens } from '../format.js'
import { t } from '../i18n/index.js'
import { AccountCard } from '../layout/AccountLevels.js'
import '../layout/accountLevels.css'
import { useNow } from '../layout/useNow.js'
import { useLive } from '../live/context.js'
import { AccountTag } from '../ui/AccountTag.js'
import { SectionLabel } from '../ui/blocks.js'
import { BranchIcon } from '../ui/icons.js'
import { modelName } from '../ui/runLabel.js'
import { Tipped } from '../ui/Tipped.js'
import { checkpointMark, ringFacts, type RingFacts } from './contextRing.js'
import { EditSize } from './ToolCalls.js'
import type { EditTotal } from './toolGroups.js'
import './chatStatus.css'

/** What the status line knows of a session: all of it for one the state lists, the branch and context of a past one. */
export interface StatusFacts {
  sessionId: string
  agent: string | undefined
  account: string | null
  branch: string | null
  model: string | null
  /** `null` — nothing is known of the context. */
  context: { tokens: number; window: number | null } | null
}

/** The facts of the window's session: from the chat's target or the state, else read once from its record. */
export function useStatusFacts(sessionId: string, account: string | null, listed: SessionView | null): StatusFacts {
  const { session } = useLive()
  const [record, setRecord] = useState<SessionRecord | null>(null)
  const known = listed !== null
  useEffect(() => {
    if (known) return
    let alive = true
    session(sessionId).then(
      (found) => alive && setRecord(found),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [sessionId, known])
  if (listed !== null) {
    return {
      sessionId,
      agent: listed.agent,
      account,
      branch: listed.branch,
      model: listed.model,
      context: { tokens: listed.contextTokens, window: listed.contextWindow },
    }
  }
  return {
    sessionId,
    agent: undefined,
    account: account ?? record?.account ?? null,
    branch: record?.branch ?? null,
    model: null,
    context: record === null || record.contextTokens === 0 ? null : { tokens: record.contextTokens, window: record.contextWindow },
  }
}

interface Props {
  facts: StatusFacts
  scale: ContextScale | null
  edits: EditTotal | null
}

/**
 * The line under the chat's field, what the session is at now: its branch and edits at the left; its account, the
 * model of its last answer and the ring of its context at the right.
 */
export function ChatStatus({ facts, scale, edits }: Props) {
  const place = [facts.branch === null ? null : t.session.chat.head.branch(facts.branch), edits === null ? null : t.session.chat.head.edits(edits.added, edits.removed)].filter(
    (part) => part !== null,
  )
  return (
    <div className="chat-status">
      {place.length > 0 && (
        <Tipped inline align="start" className="chat-status__place" tip={place.map((part) => <span key={part} className="chat-status__tip-line">{part}</span>)} focusable>
          {facts.branch !== null && (
            <span className="chat-status__branch">
              <BranchIcon />
              <span className="chat-status__branch-name">{facts.branch}</span>
            </span>
          )}
          {edits !== null && <EditSize {...edits} />}
        </Tipped>
      )}
      <span className="chat-status__session">
        <AccountTag account={facts.account} agent={facts.agent} />
        {facts.model !== null && (
          <Tipped inline className="chat-status__model" tip={`${t.session.chat.head.model}: ${facts.model}`}>
            <span className="chat-status__model-name">{modelName(facts.model)}</span>
          </Tipped>
        )}
        {facts.context !== null && <ContextRing facts={facts} context={facts.context} scale={scale} />}
      </span>
    </div>
  )
}

const RING_RADIUS = 7
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

/** A ring filled by the context's share, its figures and the account's limits in a popover opened by a press. */
function ContextRing({ facts, context, scale }: { facts: StatusFacts; context: { tokens: number; window: number | null }; scale: ContextScale | null }) {
  const { checkpoint, state } = useLive()
  const [open, setOpen] = useState(false)
  const [threshold, setThreshold] = useState<number | null>(null)
  const rootRef = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popId = useId()
  const ring = ringFacts(context.tokens, context.window, scale, threshold)
  const figures = ringFigures(ring)

  useEffect(() => {
    if (!open) return
    let alive = true
    checkpoint(facts.sessionId).then(
      (found) => alive && setThreshold(checkpointMark(found)),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [open, facts.sessionId])

  // A press outside closes it; Escape closes only it, not the chat window around it.
  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      if (rootRef.current?.contains(document.activeElement)) buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const view = state?.account
  const entry = facts.account === null ? undefined : accountOf(view, facts.account, facts.agent)
  const filled = ring.percent === null ? 0 : (RING_LENGTH * ring.percent) / 100
  return (
    <span ref={rootRef} className="context-ring">
      <button
        ref={buttonRef}
        type="button"
        className={`context-ring__button context-ring--${ring.level}${ring.percent === null ? ' context-ring--unknown' : ''}`}
        aria-label={`${t.context.label}: ${figures}`}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
          <circle className="context-ring__track" cx="9" cy="9" r={RING_RADIUS} />
          {filled > 0 && <circle className="context-ring__fill" cx="9" cy="9" r={RING_RADIUS} strokeDasharray={`${filled} ${RING_LENGTH}`} />}
        </svg>
      </button>
      {open && (
        <div id={popId} className="context-pop" role="dialog" aria-label={t.session.chat.head.ring}>
          <section className="context-pop__part">
            <SectionLabel>{t.session.context}</SectionLabel>
            <span className="context-pop__figures">{figures}</span>
            {ring.percent !== null && (
              <span className={`context-pop__bar context-ring--${ring.level}`}>
                <span className="context-pop__fill" style={{ width: `${ring.percent}%` }} />
                {ring.mark !== null && <span className="context-pop__mark" style={{ left: `${ring.mark}%` }} />}
              </span>
            )}
            {ring.mark !== null && threshold !== null && <span className="context-pop__note">{t.session.chat.head.checkpoint(formatTokens(threshold))}</span>}
          </section>
          {view !== undefined && entry !== undefined && (
            <section className="context-pop__part">
              <SectionLabel>{t.session.chat.head.account}</SectionLabel>
              <AccountNow account={view} entry={entry} />
            </section>
          )}
        </div>
      )}
    </span>
  )
}

function AccountNow({ account, entry }: { account: AccountView; entry: AccountEntry }) {
  const now = useNow(30_000)
  return <AccountCard account={account} entry={entry} now={now} />
}

/** "147k of 285k · 52%", or the tokens and "window size unknown". */
function ringFigures(ring: RingFacts): string {
  if (ring.window === null || ring.percent === null) {
    return ring.tokens > 0 ? `${formatTokens(ring.tokens)} · ${t.session.chat.head.unknownWindow}` : t.session.chat.head.unknownWindow
  }
  return t.context.of(formatTokens(ring.tokens), formatTokens(ring.window), Math.round(ring.percent))
}
