import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Notice } from '../../../src/notice/notice.js'
import type { TaskCard as Card, SubtaskRef } from '../../../src/tracker/card.js'
import { PRIORITIES, type TaskPriority, type TaskStatus } from '../../../src/tracker/model.js'
import { localized, say, t } from '../i18n/index.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { PriorityIcon } from '../ui/Priority.js'
import { Select } from '../ui/Select.js'
import { SuggestField } from '../ui/SuggestField.js'
import { carriedSubtasks, foreignMilestone, labelOffers, statusRoute } from './cardEdit.js'
import { dropDraft, leftoverOf, readDraft } from './cardDrafts.js'
import { Remove } from './CardLinks.js'
import type { CardEditor } from './useCardEdit.js'
import { useLeaving } from './useLeaving.js'

export const DAY = localized((language) => new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric' }))

type Editable = Card & { edit: NonNullable<Card['edit']> }

/**
 * The title edited in place: Enter, leaving the field, the card or the tab saves it; only Escape drops the draft; an
 * empty one is not saved. Every save is one of the browser's drafts until it lands: the next open sends one left over.
 */
export function TitleEdit({ card, editor }: { card: Card; editor: CardEditor }) {
  const [draft, setDraft] = useState<string | null>(null)
  // The draft as of now: a blur after Enter or a closing tab must not send it twice.
  const typed = useRef<string | null>(null)
  const show = (text: string | null) => {
    typed.current = text
    setDraft(text)
  }
  const save = async () => {
    const to = typed.current?.trim() ?? ''
    show(null)
    // A conflict keeps the draft in its own dialog; any other refusal is the card's band.
    if (to !== '' && to !== card.title) await editor.edit('title', card.title, to, { kept: true, keepalive: true, task: card.id })
  }
  useLeaving(() => void save())
  // The leftover is sent once per mount: React's strict mode runs a mount effect twice.
  const resent = useRef(false)
  useEffect(() => {
    if (resent.current) return
    resent.current = true
    const left = leftoverOf(readDraft(editor.project, card.id, 'title'), card.title)
    if (left === null) return dropDraft(editor.project, card.id, 'title')
    void editor.edit('title', left.from, left.to, { kept: true, task: card.id }).then((outcome) => outcome === 'refused' && show(left.to))
  }, [])
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void save()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      dropDraft(editor.project, card.id, 'title')
      show(null)
    }
  }

  if (draft === null) {
    return (
      <h2 className="task-card__title">
        <button type="button" className="task-card__title-edit" title={t.card.edit.titleHint} onClick={() => show(card.title)}>
          {card.title}
        </button>
      </h2>
    )
  }
  return (
    <h2 className="task-card__title">
      <input
        className="task-card__title-input"
        autoComplete="off"
        aria-label={t.card.edit.title}
        value={draft}
        autoFocus
        disabled={editor.busy}
        onChange={(event) => show(event.target.value)}
        onKeyDown={keys}
        onBlur={() => void save()}
      />
    </h2>
  )
}

function StatusDot({ status }: { status: TaskStatus }) {
  return (
    <span className={`task-card__status task-card__status--${status.category} task-card__status--bare`}>
      <span className="task-card__dot" />
    </span>
  )
}

interface StatusProps {
  card: Editable
  editor: CardEditor
  /** Why "Into the chain" would stop the chain. */
  refused: Notice | null
  live: boolean
}

/** The fixed statuses; a move the chain has an action for goes through that action, so the card adds no path of its own. */
export function StatusPick({ card, editor, refused, live }: StatusProps) {
  const from = card.status
  const why = (to: TaskStatus): string | undefined => {
    const route = statusRoute(from, to)
    if (route === 'unready' && live) return t.card.edit.liveBacklog
    if (route === 'ready' && refused !== null) return t.chain.readyRefused(say(refused))
    return undefined
  }
  const pick = (name: string) => {
    const to = card.edit.statuses.find((status) => status.name === name)
    if (to === undefined || to.name === from.name) return
    const route = statusRoute(from, to)
    if (route === 'edit') void editor.edit('status', from.name, to.name)
    else void editor.call('command', route === 'ready' ? 'task/ready' : 'task/unready', { task: card.id })
  }
  return (
    <Select
      className={`task-card__status-pick task-card__status--${from.category}`}
      label={t.card.edit.status}
      value={from.name}
      disabled={editor.busy}
      options={card.edit.statuses.map((status) => ({ value: status.name, label: status.name, icon: <StatusDot status={status} />, unavailable: why(status) }))}
      onChange={pick}
    />
  )
}

export function PriorityPick({ card, editor }: { card: Card; editor: CardEditor }) {
  return (
    <Select
      className="task-card__field task-card__field--quiet"
      label={t.card.priority}
      value={card.priority}
      disabled={editor.busy}
      options={PRIORITIES.map((priority) => ({ value: priority, label: t.card.priorities[priority], icon: <PriorityIcon priority={priority} /> }))}
      onChange={(next) => next !== card.priority && void editor.edit('priority', card.priority, next as TaskPriority)}
    />
  )
}

const same = (a: string | null, b: string | null) => (a ?? '').toLocaleLowerCase() === (b ?? '').toLocaleLowerCase()

/** A milestone of the project by its name, or a new one by the typed name; a parent's change may carry its open subtasks. */
export function MilestoneField({ card, editor }: { card: Editable; editor: CardEditor }) {
  const current = card.milestone?.label ?? null
  const [text, setText] = useState(current ?? '')
  const [carry, setCarry] = useState<{ to: string | null; children: SubtaskRef[] } | null>(null)
  useEffect(() => setText(current ?? ''), [current])
  const choices = card.milestones?.choices ?? []
  const typed = text.trim()
  const offers = choices.map((choice) => ({ value: choice.label, label: choice.targetDate ? t.card.due(DAY().format(choice.targetDate)) : undefined }))
  if (typed !== '' && !choices.some((choice) => same(choice.label, typed))) offers.push({ value: typed, label: t.card.edit.newMilestone })

  const commit = async (name: string) => {
    const to = name.trim() === '' ? null : name.trim()
    if (same(to, current)) return setText(current ?? '')
    const children = carriedSubtasks(card.edit.subtasks, to)
    if ((await editor.edit('milestone', current, to)) !== 'landed') return setText(current ?? '')
    if (children.length > 0) setCarry({ to, children })
  }
  const carryOn = async () => {
    const moving = carry!
    setCarry(null)
    for (const child of moving.children) {
      await editor.run('query', 'builtin/edit', { task: child.id, field: 'milestone', from: child.milestone, to: moving.to })
    }
  }
  const chosen = choices.find((choice) => same(choice.label, current))

  return (
    <div className="task-card__milestone">
      <div className="task-card__field-row">
        <SuggestField
          className="task-card__field task-card__field--quiet"
          label={t.card.milestone}
          placeholder={t.card.noMilestone}
          value={text}
          options={offers}
          disabled={editor.busy}
          onChange={setText}
          onPick={(name) => void commit(name)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void commit(text)
          }}
        />
        {current !== null && <Remove label={t.card.edit.clearMilestone} disabled={editor.busy} onPress={() => void commit('')} />}
      </div>
      {chosen?.targetDate ? <small>{t.card.due(DAY().format(chosen.targetDate))}</small> : null}
      {current !== null && foreignMilestone(card.edit.milestoneRules, current) && <p className="task-card__run-note task-card__run-note--warn">{t.card.edit.foreignMilestone}</p>}
      {carry !== null && (
        <ConfirmDialog
          title={t.card.edit.carryTitle}
          question={t.card.edit.carryQuestion(carry.children.length, carry.to)}
          confirm={t.card.edit.carry}
          cancel={t.card.edit.carryNo}
          busy={editor.busy}
          safe
          onConfirm={() => void carryOn()}
          onClose={() => setCarry(null)}
        />
      )}
    </div>
  )
}

interface LabelsProps {
  card: Editable
  editor: CardEditor
  roleText: (role: NonNullable<Card['labels'][number]['role']>) => string
}

/** Labels are added and taken off one by one, never the list replaced: a label someone else added stays. */
export function LabelsField({ card, editor, roleText }: LabelsProps) {
  const [text, setText] = useState('')
  const held = card.labels.map((label) => label.name)
  const offers = labelOffers(card.edit.labels, held, text).map((offer) => ({
    value: offer.name,
    label: offer.create ? t.card.edit.newLabel : offer.builtin ? t.card.edit.meanings[offer.name.toLocaleLowerCase()] : undefined,
  }))
  const add = async (name: string) => {
    const label = name.trim()
    if (label === '' || held.some((each) => same(each, label))) return
    if (await editor.call('query', 'builtin/labels', { task: card.id, add: [label] })) setText('')
  }

  return (
    <div className="task-card__labels">
      {card.labels.length > 0 && (
        <ul className="task-card__chips">
          {card.labels.map((label) => (
            <li
              key={label.name}
              className={`${label.role === null ? 'tag' : `chip task-card__chip--${label.role}`} task-card__chip-edit`}
              title={label.role === null ? undefined : roleText(label.role)}
            >
              {label.name}
              <Remove
                label={t.card.edit.removeLabel(label.name)}
                disabled={editor.busy}
                onPress={() => void editor.call('query', 'builtin/labels', { task: card.id, remove: [label.name] })}
              />
            </li>
          ))}
        </ul>
      )}
      <SuggestField
        className="task-card__field"
        label={t.card.edit.addLabel}
        placeholder={t.card.edit.addLabel}
        value={text}
        options={offers}
        disabled={editor.busy}
        onChange={setText}
        onPick={(name) => void add(name)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void add(text)
        }}
      />
    </div>
  )
}
