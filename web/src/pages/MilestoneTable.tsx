import { useEffect, useState, type ReactNode } from 'react'
import { milestoneSequence } from '../../../src/chain/milestone-sequence.js'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import { localized, say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { Fold } from '../ui/Fold.js'
import { PencilIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import { useDragList } from '../ui/useDragList.js'
import { closedDay, daysTo, isClosedStatus, MilestoneDot, MilestoneEditor, MilestoneRemoval, TARGET_DAY, type MilestoneRow } from './MilestoneDialogs.js'
import { HelpTip, Section } from './settingsParts.js'
import './milestoneOrder.css'
import './milestoneTable.css'

const SHORT_TARGET = localized((language) => new Intl.DateTimeFormat(language, { day: '2-digit', month: '2-digit', timeZone: 'UTC' }))
const SHORT_CLOSED = localized((language) => new Intl.DateTimeFormat(language, { day: '2-digit', month: '2-digit' }))

type Open = { kind: 'edit'; row: MilestoneRow | null } | { kind: 'remove'; row: MilestoneRow } | null

/**
 * The built-in tracker's milestones in its window (BTN-1287): every milestone, the open ones in the chain's order and
 * dragged as "Milestone order" is, the closed ones folded under them. A row opens its editor.
 */
export function MilestoneTable({ project, saved }: { project: string; saved: readonly string[] }) {
  const { query } = useLive()
  const { send, sending, failure: orderFailure } = useCommand()
  const [rows, setRows] = useState<MilestoneRow[] | null>(null)
  const [failure, setFailure] = useState<Notice | null>(null)
  const [open, setOpen] = useState<Open>(null)
  const [pending, setPending] = useState<string[] | null>(null)

  const load = async () => {
    try {
      setRows(await query<MilestoneRow[]>('builtin/milestones', { project }))
      setFailure(null)
    } catch (reason) {
      setFailure(noticeOf(reason))
    }
  }
  useEffect(() => void load(), [project])
  const done = () => {
    setOpen(null)
    void load()
  }

  const live = (rows ?? []).filter((row) => !isClosedStatus(row.status))
  const closed = (rows ?? []).filter((row) => isClosedStatus(row.status)).sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))
  const served = milestoneSequence(live.map((row) => ({ label: row.name, targetDate: row.date })), saved).map((each) => each.label)
  const order = pending ?? served
  const byName = new Map(live.map((row) => [row.name, row]))
  const manual = saved.length > 0
  useEffect(() => setPending(null), [served.join('\n'), manual])

  const save = async (next: string[]) => {
    setPending(next)
    if (!(await send('project/milestone-order', { project, order: next }))) setPending(null)
  }
  const list = useDragList<HTMLOListElement>(order, sending, (next) => void save(next))
  const edit = (row: MilestoneRow) => setOpen({ kind: 'edit', row })

  return (
    <Section
      title={t.settings.milestoneOrder}
      className="milestone-table"
      aside={
        <span className="milestone-table__aside">
          <HelpTip text={t.milestones.orderHint} lines align="start" />
          {manual ? (
            <button type="button" className="button button--small" disabled={sending} onClick={() => void save([])}>
              {t.settings.milestoneOrderBack}
            </button>
          ) : (
            <span className="tag">{t.settings.milestoneOrderAuto}</span>
          )}
          <span className="add-package__spacer" />
          <button type="button" className="button button--small" onClick={() => setOpen({ kind: 'edit', row: null })}>
            {t.milestones.add}
          </button>
        </span>
      }
    >
      {rows === null && failure === null && <p className="placeholder">{t.milestones.loading}</p>}
      {rows !== null && rows.length === 0 && <p className="placeholder">{t.milestones.empty}</p>}
      {live.length > 0 && (
        <div className="milestone-table__table">
          <Head count={t.milestones.open} phoneCount={t.milestones.tasks} date={t.milestones.target} />
          <ol ref={list.listRef} className={listClass(list.dragging, list.landing)}>
            {order.map((name, index) => {
              const row = byName.get(name)
              if (row === undefined) return null
              const offset = list.offsetOf(index)
              return (
                <li
                  key={row.id}
                  className={list.isDragged(index) ? 'milestone-table__item milestone-table__item--dragged' : 'milestone-table__item'}
                  style={offset === 0 ? undefined : { transform: `translateY(${offset}px)` }}
                >
                  <button type="button" className="milestone-order__handle milestone-table__handle" aria-label={t.settings.milestoneOrderMove(name)} disabled={order.length < 2} {...list.handle(index)}>
                    ⠿
                  </button>
                  <RowButton row={row} place={index + 1} count={row.total === 0 ? null : row.open} date={<Target date={row.date} />} onOpen={() => edit(row)} />
                </li>
              )
            })}
          </ol>
        </div>
      )}
      {closed.length > 0 && (
        <Fold
          className="milestone-table__closed"
          summaryClassName="milestone-table__fold"
          summary={
            <>
              {t.milestones.closed}
              <span className="tag">{closed.length}</span>
            </>
          }
        >
          <div className="milestone-table__table">
            <Head count={t.milestones.tasks} phoneCount={t.milestones.tasks} date={t.milestones.closedOn} phoneDate={t.milestones.date} />
            <ol className="milestone-table__list">
              {closed.map((row) => (
                <li key={row.id} className="milestone-table__item milestone-table__item--closed">
                  <span className="milestone-table__handle" aria-hidden="true" />
                  <RowButton row={row} place={null} count={row.total} date={<Closed row={row} />} onOpen={() => edit(row)} />
                </li>
              ))}
            </ol>
          </div>
        </Fold>
      )}
      {(failure ?? orderFailure) !== null && <p className="notice notice--error">{say((failure ?? orderFailure)!)}</p>}
      {open?.kind === 'edit' && (
        <MilestoneEditor
          project={project}
          row={open.row}
          onRemove={open.row === null ? undefined : () => setOpen({ kind: 'remove', row: open.row! })}
          onDone={done}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === 'remove' && (
        <MilestoneRemoval project={project} row={open.row} others={(rows ?? []).filter((each) => each.id !== open.row.id)} onDone={done} onClose={() => setOpen(null)} />
      )}
    </Section>
  )
}

/** The column heads; on the phone the count and the date take shorter names and the status column its legend. */
function Head({ count, phoneCount, date, phoneDate }: { count: string; phoneCount: string; date: string; phoneDate?: string }) {
  return (
    <div className="milestone-table__head">
      <span />
      <span className="milestone-table__place" />
      <span>{t.milestones.name}</span>
      <span className="milestone-table__count">
        <span className="milestone-table__wide">{count}</span>
        <span className="milestone-table__narrow">{phoneCount}</span>
      </span>
      <span className="milestone-table__date">
        <span className="milestone-table__wide">{date}</span>
        <span className="milestone-table__narrow">{phoneDate ?? date}</span>
      </span>
      <span className="milestone-table__status">
        <span className="milestone-table__wide">{t.milestones.status}</span>
        <span className="milestone-table__narrow">
          <HelpTip text={t.milestones.legend} />
        </span>
      </span>
      <span className="milestone-table__pencil" />
    </div>
  )
}

function RowButton({ row, place, count, date, onOpen }: { row: MilestoneRow; place: number | null; count: number | null; date: ReactNode; onOpen: () => void }) {
  return (
    <button type="button" className="milestone-table__row" aria-label={t.milestones.edit(row.name)} onClick={onOpen}>
      <span className="milestone-table__place">{place}</span>
      <span className="milestone-table__name">
        <span className="milestone-table__label">{row.name}</span>
        {row.total === 0 && !isClosedStatus(row.status) && <span className="tag">{t.milestones.fresh}</span>}
      </span>
      <span className="milestone-table__count">{count === null ? <span className="milestone-table__none">{t.milestones.none}</span> : count}</span>
      <span className="milestone-table__date">{date}</span>
      <span className="milestone-table__status">
        <span className={`milestone-pill milestone-pill--${row.status}`}>
          <MilestoneDot status={row.status} />
          <span className="milestone-pill__word">{t.milestones.statuses[row.status]}</span>
        </span>
      </span>
      <span className="milestone-table__pencil" aria-hidden="true">
        <PencilIcon />
      </span>
    </button>
  )
}

function Target({ date }: { date: number | null }) {
  if (date === null) return <span className="milestone-table__none">{t.milestones.none}</span>
  return (
    <Tipped inline tip={<><span>{TARGET_DAY().format(new Date(date))}</span><span className="tip__muted">{t.milestones.dueIn(daysTo(date))}</span></>}>
      {SHORT_TARGET().format(new Date(date))}
    </Tipped>
  )
}

function Closed({ row }: { row: MilestoneRow }) {
  if (row.closedAt === null) return <span className="milestone-table__none">{t.milestones.none}</span>
  const was = row.date === null ? t.milestones.noTarget : t.milestones.targetWas(TARGET_DAY().format(new Date(row.date)))
  return (
    <Tipped inline tip={<><span>{t.milestones.closedAt(closedDay(row.closedAt))}</span><span className="tip__muted">{was}</span></>}>
      {SHORT_CLOSED().format(new Date(row.closedAt))}
    </Tipped>
  )
}

function listClass(dragging: boolean, landing: boolean): string {
  if (dragging) return 'milestone-table__list milestone-table__list--dragging'
  return landing ? 'milestone-table__list milestone-table__list--landing' : 'milestone-table__list'
}
