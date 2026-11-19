import { useState, type ReactNode } from 'react'
import { localized, t } from '../i18n/index.js'
import { Band, Fact, FactList } from '../ui/blocks.js'
import { CheckIcon } from '../ui/icons.js'
import { Select } from '../ui/Select.js'
import { Tipped } from '../ui/Tipped.js'
import { DAY } from './CardFields.js'
import { Modal, useWrite } from './ComponentDialogs.js'
import { FieldHead, HelpTip } from './settingsParts.js'

export const MILESTONE_STATUSES = ['planned', 'active', 'completed', 'canceled'] as const
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number]
export const isClosedStatus = (status: MilestoneStatus): boolean => status === 'completed' || status === 'canceled'

/** A milestone as `builtin/milestones` lists it (BTN-1287). */
export interface MilestoneRow {
  id: string
  name: string
  /** The target date, ms at UTC midnight; `null` — none. */
  date: number | null
  description: string
  status: MilestoneStatus
  closedAt: string | null
  createdAt: string | null
  open: number
  total: number
  /** Its open tasks' ids. */
  openTasks: string[]
}

const DAY_MS = 86_400_000
/** A date the target picker gives as `YYYY-MM-DD`, kept as its UTC midnight. */
export const dateValue = (date: number | null): string => (date === null ? '' : new Date(date).toISOString().slice(0, 10))
export const dateOf = (value: string): number | null => (value === '' ? null : Date.parse(`${value}T00:00:00Z`))
/** Whole days from today to the target, both as calendar days. */
export function daysTo(date: number, now = new Date()): number {
  return Math.round((date - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / DAY_MS)
}
/** The target in full, as a calendar day whatever the time zone. */
export const TARGET_DAY = localized((language) => new Intl.DateTimeFormat(language, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }))
const CLOSED_DAY = localized((language) => new Intl.DateTimeFormat(language, { day: 'numeric', month: 'long', year: 'numeric' }))
export const closedDay = (iso: string): string => CLOSED_DAY().format(new Date(iso))

export function MilestoneDot({ status }: { status: MilestoneStatus }) {
  return <i className={`milestone-dot milestone-dot--${status}`} aria-hidden="true" />
}

/**
 * Creating a milestone (`row` null) or changing one: its name, status, target date and Markdown description. Closing one
 * with open tasks warns and goes on: the chain reads the tasks' milestones, never the milestone's status.
 */
export function MilestoneEditor({ project, row, onRemove, onDone, onClose }: { project: string; row: MilestoneRow | null; onRemove?: () => void; onDone: () => void; onClose: () => void }) {
  const [name, setName] = useState(row?.name ?? '')
  const [status, setStatus] = useState<MilestoneStatus>(row?.status ?? 'planned')
  const [date, setDate] = useState(dateValue(row?.date ?? null))
  const [description, setDescription] = useState(row?.description ?? '')
  const { busy, failure, run } = useWrite(onDone)
  const changed = row === null || name !== row.name || status !== row.status || dateOf(date) !== row.date || description !== row.description
  const ready = name.trim() !== '' && !busy && changed
  const closing = row !== null && isClosedStatus(status) && !isClosedStatus(row.status)
  const closed = row === null ? 0 : row.total - row.open
  const save = () => {
    if (ready) void run('builtin/milestone/save', { project, id: row?.id ?? null, name: name.trim(), description, status, date: dateOf(date) })
  }
  return (
    <Modal
      title={row === null ? t.milestones.newTitle : t.milestones.editTitle(row.name)}
      className="milestone-dialog"
      onClose={onClose}
      onSubmit={save}
      failure={failure}
      busy={busy}
      foot={
        <>
          {row !== null && onRemove !== undefined && (closed > 0 ? (
            <Tipped align="start" tip={<><span>{t.milestones.removeLocked(closed)}</span><span className="tip__muted">{t.milestones.removeLockedHint}</span></>}>
              <button type="button" className="button component-dialog__remove" aria-disabled="true">
                {t.milestones.remove}
              </button>
            </Tipped>
          ) : (
            <button type="button" className="button component-dialog__remove" disabled={busy} onClick={onRemove}>
              {t.milestones.remove}
            </button>
          ))}
          <span className="add-package__spacer" />
          <button type="button" className="button" disabled={busy} onClick={onClose}>
            {t.milestones.cancel}
          </button>
          <button type="submit" className="button button--primary" disabled={!ready}>
            {row === null ? t.milestones.create : closing ? t.milestones.closeMilestone : t.milestones.save}
          </button>
        </>
      }
    >
      <div className="settings__field">
        <FieldHead label={t.milestones.nameField} htmlFor="milestone-name" />
        <input
          id="milestone-name"
          className="settings__text"
          autoComplete="off"
          autoFocus
          placeholder={row === null ? t.milestones.namePlaceholder : undefined}
          value={name}
          disabled={busy}
          aria-invalid={failure?.code === 'builtin.milestoneTaken'}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="settings__field">
        <span className="settings__label">{t.milestones.statusField}</span>
        <div className="segmented milestone-status" role="group" aria-label={t.milestones.statusField}>
          {MILESTONE_STATUSES.map((each) => (
            <button
              key={each}
              type="button"
              className={status === each ? 'segmented__item segmented__item--on' : 'segmented__item'}
              aria-pressed={status === each}
              disabled={busy || (row === null && isClosedStatus(each))}
              onClick={() => setStatus(each)}
            >
              <MilestoneDot status={each} />
              {t.milestones.statuses[each]}
            </button>
          ))}
        </div>
      </div>
      {row !== null && isClosedStatus(status) && row.openTasks.length > 0 && (
        <Band tone="warn" className="milestone-dialog__open">
          <span>{t.milestones.closingOpen}</span>
          <span className="milestone-dialog__keys">
            {row.openTasks.map((task) => (
              <span key={task} className="tag milestone-dialog__key">
                {task}
              </span>
            ))}
          </span>
        </Band>
      )}
      <div className={row === null ? 'milestone-dialog__dates milestone-dialog__dates--one' : 'milestone-dialog__dates'}>
        <div className="settings__field">
          <span className="settings__head-row">
            <label className="settings__label" htmlFor="milestone-date">
              {t.milestones.targetField}
            </label>
            {row === null && <HelpTip text={t.milestones.targetHint} />}
          </span>
          <input id="milestone-date" type="date" className="settings__text" value={date} disabled={busy} onChange={(event) => setDate(event.target.value)} />
        </div>
        {row !== null && (
          <div className="settings__field">
            <span className="settings__head-row">
              <span className="settings__label">{t.milestones.closedField}</span>
              <HelpTip text={t.milestones.closedHint} />
            </span>
            <div className="milestone-dialog__readonly">{isClosedStatus(status) && row.closedAt !== null && isClosedStatus(row.status) ? closedDay(row.closedAt) : t.milestones.none}</div>
          </div>
        )}
      </div>
      <div className="settings__field">
        <FieldHead label={t.milestones.descriptionField} htmlFor="milestone-description" mark={<span className="tag">{t.milestones.markdown}</span>} />
        <textarea
          id="milestone-description"
          className="settings__text component-dialog__description"
          rows={5}
          placeholder={row === null ? t.milestones.descriptionPlaceholder : undefined}
          value={description}
          disabled={busy}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      {row !== null && (
        <FactList className="component-dialog__facts">
          <Fact label={t.milestones.openCount}>
            <dd>{row.open}</dd>
          </Fact>
          <Fact label={t.milestones.closedCount}>
            <dd>{closed}</dd>
          </Fact>
          {row.createdAt !== null && (
            <Fact label={t.milestones.created}>
              <dd>{DAY().format(new Date(row.createdAt))}</dd>
            </Fact>
          )}
        </FactList>
      )}
    </Modal>
  )
}

type Where = 'other' | 'none'

/** Deleting a milestone with no closed task: its open tasks go to another milestone or to none. */
export function MilestoneRemoval({ project, row, others, onDone, onClose }: { project: string; row: MilestoneRow; others: MilestoneRow[]; onDone: () => void; onClose: () => void }) {
  const [where, setWhere] = useState<Where>(others.length > 0 ? 'other' : 'none')
  const [to, setTo] = useState(others[0]?.id ?? '')
  const { busy, failure, run } = useWrite(onDone)
  const remove = () => {
    if (!busy) void run('builtin/milestone/delete', { project, id: row.id, ...(where === 'other' && row.total > 0 ? { to } : {}) })
  }
  const choice = (value: Where, title: string, body: ReactNode, off = false) => (
    <label className={['component-choice', where === value && 'component-choice--on', off && 'component-choice--off'].filter(Boolean).join(' ')}>
      <input type="radio" name="milestone-where" className="component-choice__radio" checked={where === value} disabled={off || busy} onChange={() => setWhere(value)} />
      <span className="component-choice__title">{title}</span>
      {body}
      {where === value && (
        <span className="component-choice__mark" aria-hidden="true">
          <CheckIcon />
        </span>
      )}
    </label>
  )
  return (
    <Modal
      title={t.milestones.removeTitle(row.name)}
      className="milestone-dialog"
      onClose={onClose}
      onSubmit={remove}
      failure={failure}
      busy={busy}
      foot={
        <>
          <HelpTip text={t.milestones.removeHint} align="start" />
          <span className="add-package__spacer" />
          <button type="button" className="button" disabled={busy} onClick={onClose}>
            {t.milestones.cancel}
          </button>
          <button type="submit" className="button button--danger" disabled={busy || (row.total > 0 && where === 'other' && to === '')}>
            {t.milestones.remove}
          </button>
        </>
      }
    >
      {row.total > 0 && (
        <div className="settings__field" role="radiogroup" aria-label={t.milestones.removeWhere(row.open)}>
          <p className="milestone-dialog__lead">{t.milestones.removeWhere(row.open)}</p>
          <div className="component-choices">
            {choice(
              'other',
              t.milestones.moveTo,
              others.length === 0 ? (
                <span className="component-choice__note">{t.milestones.noOther}</span>
              ) : (
                <Select
                  value={to}
                  label={t.milestones.moveToPick}
                  className="settings__text"
                  disabled={busy || where !== 'other'}
                  options={others.map((each) => ({ value: each.id, label: each.name }))}
                  onChange={setTo}
                />
              ),
              others.length === 0,
            )}
            {choice('none', t.milestones.moveNone, <span className="component-choice__note">{t.milestones.moveNoneNote}</span>)}
          </div>
        </div>
      )}
    </Modal>
  )
}
