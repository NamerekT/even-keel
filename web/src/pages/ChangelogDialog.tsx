import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ChangelogDraft } from '../../../src/changelog/drafts.js'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import { formatMoment } from '../format.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { ChangelogIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import '../tools/addPackage.css'
import './changelog.css'

const COPIED_MS = 2000

/** The milestone head's button: opens the changelog draft of the milestone. */
export function ChangelogButton({ project, milestone }: { project: string; milestone: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Tipped tip={t.changelog.button} inline>
        <button type="button" className="chain__changelog" aria-label={t.changelog.button} onClick={() => setOpen(true)}>
          <ChangelogIcon />
        </button>
      </Tipped>
      {open && createPortal(<ChangelogDialog project={project} milestone={milestone} onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

interface DialogProps {
  project: string
  milestone: string
  onClose: () => void
}

/** The draft of the milestone's changelog section: the last one the service kept, or one written now; Copy and Write again. */
function ChangelogDialog({ project, milestone, onClose }: DialogProps) {
  const { query } = useLive()
  const dialog = useRef<HTMLDialogElement>(null)
  const text = useRef<HTMLTextAreaElement>(null)
  const title = useId()
  const [draft, setDraft] = useState<ChangelogDraft | null>(null)
  const [failure, setFailure] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const alive = useRef(true)

  const write = async (again: boolean) => {
    setBusy(true)
    setFailure(null)
    try {
      const answer = await query<ChangelogDraft>('milestone/changelog', { project, milestone, again })
      if (alive.current) setDraft(answer)
    } catch (error) {
      if (alive.current) setFailure(noticeOf(error))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  useEffect(() => {
    alive.current = true
    if (dialog.current?.open === false) dialog.current.showModal()
    void write(false)
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    if (draft === null) return
    try {
      await navigator.clipboard.writeText(draft.text)
    } catch {
      // Plain HTTP from another host has no clipboard API: select the text and copy it the old way.
      text.current?.select()
      document.execCommand('copy')
    }
    setCopied(true)
  }

  return (
    <dialog
      ref={dialog}
      className="add-package changelog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => event.target === dialog.current && onClose()}
    >
      <div className="add-package__frame">
        <header className="add-package__head">
          <h2 id={title} className="add-package__title">
            {t.changelog.title(milestone)}
          </h2>
          <button type="button" className="panel__close" aria-label={t.packages.close} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="add-package__body">
          {draft !== null && (
            <>
              <p className="changelog__counts">{t.changelog.counts(draft.done, draft.open)}</p>
              <textarea ref={text} className="changelog__text" readOnly value={draft.text} aria-label={t.changelog.title(milestone)} />
            </>
          )}
          {draft === null && busy && (
            <p className="changelog__writing" role="status">
              {t.changelog.writing}
            </p>
          )}
          {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
        </div>
        <footer className="add-package__foot">
          {draft !== null && <span className="changelog__at">{t.changelog.at(formatMoment(draft.at, new Date()))}</span>}
          <span className="add-package__spacer" />
          <button type="button" className="button" disabled={busy} aria-busy={busy} onClick={() => void write(true)}>
            {t.changelog.again}
          </button>
          <button type="button" className="button button--primary" disabled={draft === null || busy} onClick={() => void copy()}>
            {copied ? t.changelog.copied : t.changelog.copy}
          </button>
        </footer>
      </div>
    </dialog>
  )
}
