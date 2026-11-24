import { useState, type ReactNode } from 'react'
import type { Notice } from '../../../src/notice/notice.js'
import type { TaskComment } from '../../../src/tracker/card.js'
import type { TaskChange } from '../../../src/tracker/history.js'
import { formatMoment } from '../format.js'
import { say, t } from '../i18n/index.js'
import { useCoarsePointer } from '../layout/useCoarsePointer.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { EvenKeelIcon, SendIcon, TrashIcon } from '../ui/icons.js'
import { RunLabelTag } from '../ui/RunLabelTag.js'
import { HelpTip } from './settingsParts.js'
import { CardChanges } from './CardChanges.js'
import { dropDraft, readDraft, writeDraft } from './cardDrafts.js'
import { sendsReply } from './chatKeys.js'
import { journalAuthor, journalItems, journalModel, journalWindow, repliesOf, type JournalFilter } from './journalView.js'
import type { CardEditor } from './useCardEdit.js'

interface Props {
  task: string
  comments: TaskComment[]
  history?: TaskChange[]
  /** Only a task Even Keel keeps itself: the person writes and deletes their notes. */
  editor: CardEditor | null
  render: (text: string) => ReactNode
  plain: (text: string) => ReactNode
}

/**
 * The task's comments, the newest first (BTN-1451). For the built-in tracker it is the task journal: agent reports,
 * session questions with the answers given in the page's chat, and the person's notes with a field above the entries.
 */
export function CardJournal({ task, comments, history, editor, render, plain }: Props) {
  const [all, setAll] = useState(false)
  const [filter, setFilter] = useState<JournalFilter>('all')
  const [removing, setRemoving] = useState<string | null>(null)
  const items = journalItems(comments, history ?? [], filter)
  const { shown, hidden } = journalWindow(items, all)
  const journal = history !== undefined || editor !== null || comments.some((comment) => comment.journal !== undefined)
  if (comments.length === 0 && editor === null && history === undefined) return null
  const count = journal ? items.length : comments.length

  return (
    <section className="task-card__section">
      <div className="task-card__journal-head">
        <h3 className="task-card__heading">
          {journal ? t.card.journal.heading : t.card.comments}
          {count > 0 && <> <span className="task-card__count">{count}</span></>}
          {journal && editor !== null && <HelpTip text={t.card.journal.hint} align="start" />}
        </h3>
        {history !== undefined && <div className="segmented task-card__journal-filter" role="group" aria-label={t.card.journal.filter}>
          {(['all', 'comments', 'changes'] as const).map((value) => <button key={value} type="button" className={`segmented__item${filter === value ? ' segmented__item--on' : ''}`} aria-pressed={filter === value} onClick={() => { setFilter(value); setAll(false) }}>{t.card.journal.filters[value]}</button>)}
        </div>}
      </div>
      {editor !== null && <NoteField task={task} editor={editor} />}
      {items.length === 0 && <p className="placeholder">{filter === 'all' ? t.card.journal.empty : t.card.journal.filteredEmpty}</p>}
      {shown.length > 0 && (
        <ol className="task-card__comments">
          {shown.map((item, index) => item.kind === 'changes' ? <CardChanges key={`change:${index}`} group={item.group} plain={plain} /> : (
            <Entry
              key={item.comment.journal?.id ?? `comment:${index}`}
              comment={item.comment}
              render={render}
              onRemove={editor !== null && item.comment.journal?.by === 'person' ? () => setRemoving(item.comment.journal!.id) : null}
              busy={editor?.busy ?? false}
            />
          ))}
        </ol>
      )}
      {hidden > 0 && (
        <button type="button" className="task-card__ghost task-card__journal-more" onClick={() => setAll(true)}>
          {t.card.journal.more(hidden)}
        </button>
      )}
      {removing !== null && editor !== null && <RemoveNote task={task} comment={removing} editor={editor} onClose={() => setRemoving(null)} />}
    </section>
  )
}

function Entry({ comment, render, onRemove, busy }: { comment: TaskComment; render: (text: string) => ReactNode; onRemove: (() => void) | null; busy: boolean }) {
  const author = journalAuthor(comment, { ...t.card.journal, noAuthor: t.card.noAuthor })
  const model = journalModel(comment.journal?.model)
  const at = new Date(comment.at).toISOString()
  const replies = repliesOf(comment)
  return (
    <li className={`task-card__comment${comment.journal?.by === 'person' ? ' task-card__comment--mine' : ''}`}>
      <span className="task-card__avatar" aria-hidden="true">
        {comment.journal?.by === 'service' ? <EvenKeelIcon /> : (comment.journal === undefined ? (comment.author ?? '·') : author).trim().charAt(0).toLocaleUpperCase()}
      </span>
      <div className="task-card__bubble">
        <div className="task-card__comment-head">
          <strong>{author}</strong>
          {model !== null && <RunLabelTag run={model} />}
          <time dateTime={at}>{formatMoment(at, new Date())}</time>
          {onRemove !== null && (
            <button type="button" className="task-card__remove task-card__comment-remove" aria-label={t.card.journal.remove} title={t.card.journal.remove} disabled={busy} onClick={onRemove}>
              <TrashIcon />
            </button>
          )}
        </div>
        {render(comment.text)}
      </div>
      {replies.length > 0 && (
        <ol className="task-card__comments task-card__replies" aria-label={t.card.replies(replies.length)}>
          {replies.map((reply, index) => (
            <Entry key={index} comment={reply} render={render} onRemove={null} busy={busy} />
          ))}
        </ol>
      )}
    </li>
  )
}

/** A note not sent is never published on its own: it stays the browser's draft and is back in the field on the next open. */
function NoteField({ task, editor }: { task: string; editor: CardEditor }) {
  const coarsePointer = useCoarsePointer()
  const [text, setText] = useState(() => readDraft(editor.project, task, 'note')?.to ?? '')
  const [refusal, setRefusal] = useState<Notice | null>(null)
  const drafting = text.trim() !== ''

  const type = (next: string) => {
    setText(next)
    if (next.trim() === '') dropDraft(editor.project, task, 'note')
    else writeDraft(editor.project, task, 'note', { from: '', to: next })
  }
  const send = async () => {
    if (!drafting || editor.busy) return
    setRefusal(null)
    const refused = await editor.run('query', 'builtin/comment', { task, text: text.trim() })
    if (refused === null) type('')
    else setRefusal(refused)
  }

  return (
    <form
      className="task-card__draft"
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
    >
      <div className="task-card__note-row">
        <textarea
          className="task-card__field task-card__note-field"
          rows={2}
          aria-label={t.card.journal.note}
          placeholder={coarsePointer ? t.card.journal.touchPlaceholder : t.card.journal.placeholder}
          value={text}
          readOnly={editor.busy}
          aria-invalid={refusal !== null || undefined}
          onChange={(event) => type(event.target.value)}
          onKeyDown={(event) => {
            if (!sendsReply(event.nativeEvent, coarsePointer)) return
            event.preventDefault()
            void send()
          }}
        />
        <button type="submit" className="task-card__note-send" aria-label={t.card.journal.send} title={t.card.journal.send} disabled={!drafting || editor.busy}>
          <SendIcon />
        </button>
      </div>
      {refusal !== null && <p className="notice notice--error">{say(refusal)}</p>}
    </form>
  )
}

function RemoveNote({ task, comment, editor, onClose }: { task: string; comment: string; editor: CardEditor; onClose: () => void }) {
  const [failure, setFailure] = useState<Notice | null>(null)
  return (
    <ConfirmDialog
      title={t.card.journal.removeTitle}
      question={t.card.journal.removeQuestion}
      confirm={t.card.journal.removeConfirm}
      cancel={t.card.edit.cancel}
      busy={editor.busy}
      failure={failure === null ? undefined : say(failure)}
      onConfirm={() => void editor.run('query', 'builtin/uncomment', { task, comment }).then((refused) => (refused === null ? onClose() : setFailure(refused)))}
      onClose={onClose}
    />
  )
}
