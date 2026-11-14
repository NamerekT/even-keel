import { useState, type KeyboardEvent } from 'react'
import type { Notice } from '../../../src/notice/notice.js'
import type { TaskCard as Card, TaskRef } from '../../../src/tracker/card.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { PlusIcon } from '../ui/icons.js'
import { chainOrdered, isClosed, parentRefusal } from './cardEdit.js'
import { RefLink, Remove, TaskSearch } from './CardLinks.js'
import type { CardEditor } from './useCardEdit.js'

type Editable = Card & { edit: NonNullable<Card['edit']> }

/** Root → … → the direct parent, over the title; each opens its own card. */
export function AncestorPath({ ancestors, onOpen }: { ancestors: TaskRef[]; onOpen: (task: string) => void }) {
  if (ancestors.length === 0) return null
  return (
    <nav className="task-card__path" aria-label={t.card.edit.path}>
      <ol>
        {ancestors.map((each) => (
          <li key={each.id}>
            <button type="button" className="task-card__path-step" title={each.title} onClick={() => onOpen(each.id)}>
              <span className="task-card__ref-key">{each.id}</span>
              <span className="task-card__path-title">{each.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}

interface ParentProps {
  card: Editable
  /** The task's project GUID: a parent is one of its own project's tasks. */
  project: string
  editor: CardEditor
  onOpen: (task: string) => void
}

export function ParentField({ card, project, editor, onOpen }: ParentProps) {
  const [picking, setPicking] = useState(false)
  const [refusal, setRefusal] = useState<Notice | null>(null)
  const from = card.parent?.id ?? null
  const close = () => {
    setPicking(false)
    setRefusal(null)
  }
  const pick = async (parent: string) => {
    const refused = parentRefusal(card.id, card.subtasks ?? [], parent)
    if (refused !== null) return setRefusal(refused)
    if (parent === from) return close()
    const answer = await editor.run('query', 'builtin/edit', { task: card.id, field: 'parent', from, to: parent })
    if (answer === null) close()
    else setRefusal(answer)
  }

  if (picking) return <TaskSearch project={project} label={t.card.edit.changeParent} refusal={refusal} onPick={(parent) => void pick(parent)} onClose={close} />
  if (card.parent === null) {
    return (
      <button type="button" className="task-card__ghost task-card__ghost--inline" onClick={() => setPicking(true)}>
        {t.card.edit.setParent}
      </button>
    )
  }
  return (
    <div className="task-card__parent">
      <div className="task-card__ref-row">
        <RefLink item={card.parent} onOpen={onOpen} />
        <Remove label={t.card.edit.dropParent} disabled={editor.busy} onPress={() => void editor.edit('parent', from, null)} />
      </div>
      <button type="button" className="task-card__ghost" disabled={editor.busy} onClick={() => setPicking(true)}>
        {t.card.edit.changeParent}
      </button>
    </div>
  )
}

interface SubtasksProps {
  card: Card
  project: string
  /** Only a card Even Keel edits itself adds subtasks; any other tracker's list is read-only. */
  adding: { card: Editable; editor: CardEditor } | null
  /** The task is the chain's current one or a session of it is live: a first subtask takes it out of the chain. */
  inWork: boolean
  onOpen: (task: string) => void
}

/** The children in the chain's order, with a ghost field that adds one where the card edits; a closed task takes no new subtask. */
export function Subtasks({ card, project, adding, inWork, onOpen }: SubtasksProps) {
  const { state } = useLive()
  const subtasks = card.subtasks ?? []
  const add = adding !== null && !isClosed(card.status) ? adding : null
  if (subtasks.length === 0 && add === null) return null
  const order = state?.chain.projects[project]?.order ?? []
  const closed = subtasks.filter((child) => isClosed(child.status)).length

  return (
    <section className="task-card__section">
      <h3 className="task-card__heading">{t.card.edit.subtasks(closed, subtasks.length)}</h3>
      {subtasks.length > 0 && (
        <ul className="task-card__refs task-card__subtasks">
          {chainOrdered(subtasks, order).map((child) => (
            <li key={child.id} className="task-card__subtask">
              <RefLink item={child} onOpen={onOpen} />
              <span className={`task-card__subtask-status task-card__status--${child.status.category}`}>{child.status.name}</span>
            </li>
          ))}
        </ul>
      )}
      {add !== null && <AddSubtask card={add.card} project={project} editor={add.editor} confirmFirst={inWork && subtasks.length === 0} />}
    </section>
  )
}

function AddSubtask({ card, project, editor, confirmFirst }: { card: Editable; project: string; editor: CardEditor; confirmFirst: boolean }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [refusal, setRefusal] = useState<Notice | null>(null)

  const create = async (title: string) => {
    const answer = await editor.run('query', 'builtin/create', { project, title, parent: card.id, milestone: card.milestone?.label ?? null, status: 'Todo' })
    setRefusal(answer)
    // The field stays open for the next one.
    if (answer === null) setDraft('')
  }
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      const title = draft?.trim() ?? ''
      if (title === '') return
      if (confirmFirst) setAsking(true)
      else void create(title)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setDraft(null)
      setRefusal(null)
    }
  }

  if (draft === null) {
    return (
      <button type="button" className="task-card__ghost" onClick={() => setDraft('')}>
        <PlusIcon />
        {t.card.edit.addSubtask}
      </button>
    )
  }
  return (
    <div className="task-card__add">
      <input
        className="task-card__field"
        autoComplete="off"
        aria-label={t.card.edit.subtaskTitle}
        placeholder={t.card.edit.subtaskTitle}
        value={draft}
        autoFocus
        disabled={editor.busy}
        aria-invalid={refusal !== null || undefined}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={keys}
      />
      {refusal !== null && <p className="notice notice--error">{say(refusal)}</p>}
      {asking && (
        <ConfirmDialog
          title={t.card.edit.firstTitle}
          question={t.card.edit.firstQuestion(card.id)}
          confirm={t.card.edit.firstConfirm}
          cancel={t.card.edit.cancel}
          busy={editor.busy}
          safe
          onConfirm={() => {
            setAsking(false)
            void create(draft.trim())
          }}
          onClose={() => setAsking(false)}
        />
      )}
    </div>
  )
}
