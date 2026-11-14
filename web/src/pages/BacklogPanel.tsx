import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react'
import type { TaskRun } from '../../../src/sessions/runs.js'
import type { TaskWork } from '../../../src/state.js'
import type { Task } from '../../../src/tracker/model.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import type { ReadyButton, TaskLinks } from '../state.js'
import { ByPriorityIcon, FlagIcon, IntoChainIcon, NewestFirstIcon, OldestFirstIcon, SearchIcon, StackIcon } from '../ui/icons.js'
import { Links } from '../ui/Links.js'
import { PriorityIcon } from '../ui/Priority.js'
import { RunLabelTag } from '../ui/RunLabelTag.js'
import { Tipped } from '../ui/Tipped.js'
import { WorkChip } from '../ui/WorkChip.js'
import { BACKLOG_PLACE } from '../ui/addGhost.js'
import { AddGhost } from './AddGhost.js'
import { BACKLOG_ORDERS, type BacklogOrder, sortBacklog, useBacklogOrder } from './backlogOrder.js'
import { BACKLOG_PAGE, nextLimit, searchBacklog } from './backlogSearch.js'
import { SEG_CLASS, type ChipLook } from './chipLook.js'
import '../stats/overview.css'
import './backlog.css'

/** The address hash that opens the backlog panel; a task id never equals it. */
export const BACKLOG_HASH = 'backlog'

/** `.backlog__row--leaving` in backlog.css: the slide and the fold after it. */
const LEAVE_MS = 480

/** A tag in the head row, a tab on the side column's card, or a segment showing only the count. */
const BACKLOG_CLASS: Record<ChipLook, string> = { tag: 'tag tag--backlog', tab: 'side-tab side-tab--wide', seg: SEG_CLASS }

interface ChipProps {
  count: number
  open: boolean
  look?: ChipLook
  /** One of the backlog's tasks has work in its folder that main does not (BTN-298): a red dot. */
  work?: boolean
  /** Shown at a count of 0 too: the built-in tracker's backlog is where its tasks are made (BTN-770). */
  always?: boolean
  onToggle: () => void
}

export function BacklogChip({ count, open, look = 'tag', work = false, always = false, onToggle }: ChipProps) {
  if (count === 0 && !always) return null
  const seg = look === 'seg'
  return (
    <button
      type="button"
      className={BACKLOG_CLASS[look]}
      aria-expanded={open}
      aria-label={seg ? t.project.backlog(count) : undefined}
      title={work ? `${t.project.backlogHint}\n${t.chain.work.backlog}` : t.project.backlogHint}
      onClick={onToggle}
    >
      <StackIcon />
      {seg ? count : t.project.backlog(count)}
      {work && <span className="work-dot" role="img" aria-label={t.chain.work.backlog} />}
    </button>
  )
}

interface Props {
  tasks: Task[]
  /** What the tasks' sessions run on where their card set it (`state.runs` of the project), by task. */
  runs: Record<string, TaskRun>
  /** The work left in the tasks' folders, by task. */
  works: Record<string, TaskWork>
  /** The task's "Into the chain" button, `null` for none. */
  ready: (task: Task) => ReadyButton | null
  links: (task: string) => TaskLinks
  onCard: (task: string) => void
  onClose: () => void
  /** The task whose Todo button is pointed at, `null` when none is. */
  onPoint: (task: string | null) => void
  /** The task whose row slides out on its way into the chain. */
  leaving: string | null
  onMove: (task: Task) => void
  /** The Todo command for the task has been answered. */
  onSettled: (task: string) => void
  /** The project's GUID when it is on the built-in tracker: a ghost on top makes a backlog task; `null` — another tracker. */
  adding?: string | null
  /** The tasks an outsider changed the text of after their entry label (`ProjectOrder.changed`): a mark says why they wait. */
  changed?: readonly string[]
}

export function BacklogPanel({ tasks, runs, works, ready: buttonOf, links, onCard, onClose, onPoint, leaving, onMove, onSettled, adding = null, changed = [] }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const { send, sending, failure } = useCommand()
  const point = useRef(onPoint)
  point.current = onPoint
  const [out, setOut] = useState<{ task: Task; index: number } | null>(null)
  // The tasks there as the panel opened: one that comes later unfolds into its place, as a new block of the chain does.
  const known = useRef<ReadonlySet<string> | null>(null)
  known.current ??= new Set(tasks.map((task) => task.id))
  const mixed = new Set(tasks.map((task) => task.status.name)).size > 1
  const [order, setOrder] = useBacklogOrder()
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(BACKLOG_PAGE)
  const searching = query.trim() !== ''
  const runOf = (task: string) => runs[task] ?? null
  const found = searchBacklog(sortBacklog(tasks, order), query, runOf)
  // The row finishes sliding out even when the chain takes the task before it is gone.
  const rows =
    out === null || found.some((task) => task.id === out.task.id) ? found : [...found.slice(0, out.index), out.task, ...found.slice(out.index)]
  const shown = rows.slice(0, limit)
  const left = rows.length - shown.length
  const search = (text: string) => {
    setQuery(text)
    setLimit(BACKLOG_PAGE)
  }
  const queryRef = useRef(query)
  queryRef.current = query

  useEffect(() => closeRef.current?.focus({ preventScroll: true }), [])
  useEffect(() => () => point.current(null), [])
  useEffect(() => {
    if (out === null) return
    const timer = setTimeout(() => setOut(null), LEAVE_MS)
    return () => clearTimeout(timer)
  }, [out])

  // mousemove, not mouseenter: Chrome fires a synthetic enter when the row under a still cursor disappears.
  const pointAt = (event: SyntheticEvent) => onPoint((event.target as HTMLElement).closest<HTMLElement>('[data-ready]')?.dataset.ready ?? null)
  const ready = (task: Task) => {
    setOut({ task, index: found.indexOf(task) })
    onMove(task)
    void send('task/ready', { task: task.id }).then(() => onSettled(task.id))
  }

  // Escape clears a search first and closes the panel only when there is none.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]') !== null) return
      if (queryRef.current === '') return onClose()
      setQuery('')
      setLimit(BACKLOG_PAGE)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside className="panel backlog" aria-label={t.project.backlog(tasks.length)}>
      <header className="panel__head">
        <h2 className="panel__task backlog__title">
          <span className="backlog__title-text">
            <StackIcon />
            {t.project.backlog(tasks.length)}
          </span>
          {searching && <span className="backlog__found">{t.project.backlogFound(found.length, tasks.length)}</span>}
        </h2>
        <OrderSwitch value={order} onChange={setOrder} />
        <button ref={closeRef} type="button" className="panel__close" aria-label={t.session.closePanel} onClick={onClose}>
          ×
        </button>
      </header>
      <p className="chain__hint">{t.project.backlogHint}</p>
      <SearchField value={query} onChange={search} />
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      <ol
        className={shown.some((task) => buttonOf(task) !== null) ? 'backlog__list backlog__list--ready' : 'backlog__list'}
        onMouseMove={pointAt}
        onFocus={pointAt}
        onMouseLeave={() => onPoint(null)}
        onBlur={() => onPoint(null)}
      >
        {adding !== null && (
          <li className="backlog__add">
            <AddGhost project={adding} place={BACKLOG_PLACE} label={t.chain.add.task} onCard={onCard} />
          </li>
        )}
        {shown.map((task) => {
          const run = runOf(task.id)
          const button = buttonOf(task)
          const reason = button?.refused ?? null
          const gone = task.id === leaving || task.id === out?.task.id
          return (
            <li
              key={task.id}
              className={`backlog__row backlog__row--${task.priority}${gone ? ' backlog__row--leaving' : known.current?.has(task.id) === false ? ' backlog__row--new' : ''}`}
            >
              {button !== null && (
                <button
                  type="button"
                  className="backlog__ready"
                  disabled={sending || reason !== null}
                  aria-label={t.card.ready}
                  title={reason === null ? undefined : t.chain.readyRefused(say(reason))}
                  data-ready={reason === null ? task.id : undefined}
                  onClick={() => ready(task)}
                >
                  <IntoChainIcon />
                </button>
              )}
              <div className="backlog__meta">
                <span className="backlog__priority" title={`${t.card.priority}: ${t.card.priorities[task.priority]}`}>
                  <PriorityIcon priority={task.priority} />
                </span>
                {/* A press anywhere on the row opens the card, which links to the tracker. */}
                <button type="button" className="backlog__key" title={t.chain.openCard} onClick={() => onCard(task.id)}>
                  {task.id}
                </button>
                {task.parent !== null && (
                  <span className="backlog__parent" title={t.card.parent}>
                    ↳ {task.parent}
                  </span>
                )}
                {run !== null && <RunLabelTag run={run} />}
                {mixed && <span className="backlog__status">{task.status.name}</span>}
                <span
                  className={task.milestone === null ? 'backlog__milestone backlog__milestone--none' : 'backlog__milestone'}
                  title={`${t.card.milestone}: ${task.milestone?.label ?? t.chain.noMilestone}`}
                >
                  <FlagIcon />
                  <span className="backlog__milestone-name">{task.milestone?.label ?? t.chain.noMilestone}</span>
                </span>
                <span className="backlog__tail">
                  {works[task.id] !== undefined && <WorkChip work={works[task.id]!} />}
                  <Links links={links(task.id)} onCard={onCard} />
                </span>
              </div>
              <p className="backlog__name">
                {/* Before the text it is about, and off the meta line, whose run and milestone already share it tightly. */}
                {changed.includes(task.id) && (
                  <Tipped tip={t.chain.changedTip} focusable inline className="backlog__changed">
                    <span className="chip chip--changed">{t.chain.changed}</span>
                  </Tipped>
                )}
                {task.title}
              </p>
            </li>
          )
        })}
      </ol>
      {searching && rows.length === 0 && <p className="placeholder backlog__nothing">{t.project.backlogNothing}</p>}
      {left > 0 && (
        <Tipped tip={t.project.backlogMoreTip(left)} className="backlog__more">
          <button type="button" className="button button--small" onClick={() => setLimit(nextLimit(limit, rows.length))}>
            {t.project.backlogMore(Math.min(left, BACKLOG_PAGE))}
          </button>
        </Tipped>
      )}
    </aside>
  )
}

/** The backlog's search: a magnifier, the field and a cross that clears it. */
function SearchField({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const field = useRef<HTMLInputElement>(null)
  return (
    <div className="backlog__search">
      <SearchIcon />
      <input
        ref={field}
        type="text"
        className="backlog__search-field"
        autoComplete="off"
        spellCheck={false}
        placeholder={t.project.backlogSearchPlaceholder}
        aria-label={t.project.backlogSearch}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value !== '' && (
        <Tipped tip={t.project.backlogSearchClear} inline className="backlog__search-clear">
          <button
            type="button"
            aria-label={t.project.backlogSearchClear}
            onClick={() => {
              onChange('')
              field.current?.focus()
            }}
          >
            ×
          </button>
        </Tipped>
      )}
    </div>
  )
}

const ORDER_ICONS: Record<BacklogOrder, () => ReactNode> = { new: NewestFirstIcon, old: OldestFirstIcon, priority: ByPriorityIcon }

function OrderSwitch({ value, onChange }: { value: BacklogOrder; onChange: (order: BacklogOrder) => void }) {
  return (
    <div className="segmented backlog__order" role="group" aria-label={t.project.backlogOrder}>
      {BACKLOG_ORDERS.map((order) => {
        const Icon = ORDER_ICONS[order]
        return (
          <Tipped key={order} tip={t.project.backlogOrders[order]} inline>
            <button
              type="button"
              className={order === value ? 'segmented__item segmented__item--on' : 'segmented__item'}
              aria-label={t.project.backlogOrders[order]}
              aria-pressed={order === value}
              onClick={() => onChange(order)}
            >
              <Icon />
            </button>
          </Tipped>
        )
      })}
    </div>
  )
}
