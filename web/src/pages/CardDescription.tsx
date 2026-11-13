import { lazy, Suspense, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { diffSection } from '../../../src/changelog/diff.js'
import type { Notice } from '../../../src/notice/notice.js'
import { ATTACHMENT_LIMIT_MB } from '../../../src/builtin/model.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { DiffLines } from '../ui/DiffLines.js'
import { Loading } from '../ui/Loader.js'
import { Tipped } from '../ui/Tipped.js'
import { dropDraft, leftoverOf, readDraft, writeDraft } from './cardDrafts.js'
import { conflictOf } from './cardEdit.js'
import type { CardEditor } from './useCardEdit.js'
import { useHeld } from './useHeld.js'
import { useLeaving, type Leaving } from './useLeaving.js'
import '../tools/addPackage.css'
import './description.css'

const DescriptionEditor = lazy(() => import('./DescriptionEditor.js').then((module) => ({ default: module.DescriptionEditor })))

interface Props {
  task: string
  /** The description the card holds now; the editor takes it once, when it opens, and the poll does not touch it after. */
  text: string
  editor: CardEditor
  render: (text: string) => ReactNode
}

interface Editing {
  start: string
  text: string
  revision: number
}

/**
 * A built-in tracker's description: rendered as on every card, edited in place in the editor's own chunk (BTN-772).
 * Closing the card or the tab saves the edit (BTN-1027); only the editor's Cancel drops it.
 */
export function CardDescription({ task, text, editor, render }: Props) {
  const [editing, setEditing] = useState<Editing | null>(null)
  const [conflict, setConflict] = useState<{ theirs: string; mine: string } | null>(null)
  // Mine after "take the new one": kept until the card closes.
  const [kept, setKept] = useState<string | null>(null)
  const [failure, setFailure] = useState<Notice | null>(null)
  const { state, attach } = useLive()
  // The text last sent as the tab went away: `visibilitychange` and `pagehide` of one close send it once.
  const flushed = useRef<string | null>(null)
  // What was saved stands in the view until the card is read anew (BTN-1111).
  const held = useHeld(text)
  const shown = held.shown

  const open = () => {
    setFailure(null)
    setEditing({ start: shown, text: shown, revision: 0 })
  }
  const close = () => {
    setEditing(null)
    setFailure(null)
  }
  const drop = () => {
    dropDraft(editor.project, task, 'description')
    close()
  }
  const save = async (from: string, to: string, leaving?: Leaving) => {
    // Nothing changed: no request, so no conflict can come of it.
    if (to === from) return close()
    setFailure(null)
    writeDraft(editor.project, task, 'description', { from, to })
    const refused = await editor.run('query', 'builtin/edit', { task, field: 'description', from, to }, { keepalive: leaving !== undefined })
    if (refused === null) {
      dropDraft(editor.project, task, 'description')
      setConflict(null)
      held.hold(to)
      // The tab only went out of sight: the editor stays open on what was saved.
      if (leaving === 'hidden') return setEditing((now) => (now === null ? now : { ...now, start: to }))
      return close()
    }
    // The draft stays: a card already closed shows the conflict on its next open.
    const found = conflictOf(refused, to)
    setConflict(found === null ? null : { theirs: found.theirs ?? '', mine: to })
    if (found === null) setFailure(refused)
  }

  useLeaving((leaving) => {
    if (editing === null || editing.text === editing.start || flushed.current === editing.text) return
    flushed.current = editing.text
    void save(editing.start, editing.text, leaving)
  })
  // The leftover is sent once per mount: React's strict mode runs a mount effect twice.
  const resent = useRef(false)
  useEffect(() => {
    if (resent.current) return
    resent.current = true
    const left = leftoverOf(readDraft(editor.project, task, 'description'), text)
    if (left === null) return dropDraft(editor.project, task, 'description')
    setEditing({ start: left.from, text: left.to, revision: 0 })
    void save(left.from, left.to)
  }, [])

  return (
    <section className="task-card__section">
      {editing === null ? (
        <>
          <div className="description__head">
            <h3 className="task-card__heading">{t.card.description}</h3>
            <Tipped tip={t.card.edit.describe.editTip} inline>
              <button type="button" className="task-card__ghost description__edit" onClick={open}>
                {t.card.edit.describe.edit}
              </button>
            </Tipped>
          </div>
          <div className="description__view" onDoubleClick={open}>
            {shown.trim() === '' ? <p className="placeholder">{t.card.noDescription}</p> : render(shown)}
          </div>
        </>
      ) : (
        <Suspense fallback={<Loading busy label={t.card.loading} fit="block">{null}</Loading>}>
          <DescriptionEditor
            start={editing.start}
            text={editing.text}
            revision={editing.revision}
            busy={editor.busy}
            failure={failure}
            limit={(state?.config.shared.attachmentLimit ?? ATTACHMENT_LIMIT_MB) * 1024 * 1024}
            onText={(next) => setEditing((now) => (now === null ? now : { ...now, text: next }))}
            onUpload={async (file) => {
              const done = await attach(task, file)
              editor.reload()
              return done
            }}
            onSave={() => void save(editing.start, editing.text)}
            onClose={drop}
          />
        </Suspense>
      )}
      {kept !== null && (
        <KeptDraft
          text={kept}
          canPutBack={editing !== null && editing.text !== kept}
          onPutBack={() => setEditing((now) => (now === null ? now : { ...now, text: kept, revision: now.revision + 1 }))}
        />
      )}
      {conflict !== null && (
        <ConflictWindow
          theirs={conflict.theirs}
          mine={conflict.mine}
          busy={editor.busy}
          onKeep={() => void save(conflict.theirs, conflict.mine)}
          onTake={() => {
            dropDraft(editor.project, task, 'description')
            setKept(conflict.mine)
            setEditing((now) => ({ start: conflict.theirs, text: conflict.theirs, revision: (now?.revision ?? 0) + 1 }))
            setConflict(null)
            editor.settle()
          }}
        />
      )}
    </section>
  )
}

/** Mine, after the new version was taken: to copy from or to put back over it, while the card is open. */
function KeptDraft({ text, canPutBack, onPutBack }: { text: string; canPutBack: boolean; onPutBack: () => void }) {
  const [copied, setCopied] = useState(false)
  // Plain HTTP from another host has no clipboard: the text stays selectable.
  const canCopy = typeof navigator !== 'undefined' && navigator.clipboard !== undefined
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = () =>
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    })
  return (
    <div className="description__kept">
      <div className="description__kept-head">
        <strong>{t.card.edit.describe.mine}</strong>
        <span className="description__hint">{t.card.edit.describe.mineHint}</span>
        <span className="description__spacer" />
        {canCopy && (
          <button type="button" className="button button--small" onClick={copy}>
            {copied ? t.card.edit.describe.copied : t.card.edit.describe.copy}
          </button>
        )}
        {canPutBack && (
          <button type="button" className="button button--small" onClick={onPutBack}>
            {t.card.edit.describe.putBack}
          </button>
        )}
      </div>
      <pre className="description__kept-text">{text}</pre>
    </div>
  )
}

/** Theirs against mine, line by line: what keeping mine would overwrite is red. */
function ConflictWindow({ theirs, mine, busy, onKeep, onTake }: { theirs: string; mine: string; busy: boolean; onKeep: () => void; onTake: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, onTake)
  const heading = useId()
  const lines = diffSection(theirs, mine)
  const lost = lines.filter((line) => line.kind === 'removed' || line.kind === 'changed').length
  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])
  return (
    <dialog
      ref={dialog}
      className="add-package description__conflict"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault()
        // React passes `cancel` up its own tree: the card would close too.
        event.stopPropagation()
        onTake()
      }}
      {...backdrop}
    >
      <div className="add-package__frame">
        <header className="add-package__head">
          <h2 id={heading} className="add-package__title">
            {t.card.edit.describe.conflictTitle}
          </h2>
        </header>
        <div className="add-package__body">
          <p className="add-package__question">{t.card.edit.describe.overwritten(lost)}</p>
          <p className="description__hint">{t.card.edit.describe.conflictLegend}</p>
          <div className="description__diff" role="document" aria-label={t.card.edit.describe.conflictTitle} tabIndex={0}>
            <DiffLines lines={lines} />
          </div>
        </div>
        <footer className="add-package__foot">
          <span className="add-package__spacer" />
          <button type="button" className="button" disabled={busy} onClick={onTake}>
            {t.card.edit.takeNew}
          </button>
          <button type="button" className="button button--primary" disabled={busy} onClick={onKeep}>
            {t.card.edit.keepMine}
          </button>
        </footer>
      </div>
    </dialog>
  )
}
