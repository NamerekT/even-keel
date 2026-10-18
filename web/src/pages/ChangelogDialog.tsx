import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { diffSection, type DiffLine } from '../../../src/changelog/diff.js'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import type { ChangelogView } from '../../../src/state.js'
import { sinceWritten, unaccounted } from '../changelog.js'
import { formatMoment } from '../format.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { ChangelogIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import '../tools/addPackage.css'
import './changelog.css'

const COPIED_MS = 2000
const SHORT_COMMIT = 7

type Op = 'open' | 'again' | 'add' | 'edit' | 'write'

/** The milestone head's button: opens the changelog draft of the milestone; next to it, the done tasks closed since it was written. */
export function ChangelogButton({ project, milestone }: { project: string; milestone: string }) {
  const { state } = useLive()
  const [open, setOpen] = useState(false)
  const since = state === null ? null : sinceWritten(state, project, milestone)
  return (
    <>
      {since !== null && since > 0 && (
        <Tipped tip={t.changelog.sinceTip} inline focusable className="chain__changelog-since">
          {t.changelog.since(since)}
        </Tipped>
      )}
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

/**
 * The milestone's changelog section: its newest version with what it changed marked, an edit in words, adding the
 * tasks closed since, writing it again, copying it and writing it to the file with a commit.
 */
function ChangelogDialog({ project, milestone, onClose }: DialogProps) {
  const { query, state } = useLive()
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  const [view, setView] = useState<ChangelogView | null>(null)
  const [failure, setFailure] = useState<Notice | null>(null)
  const [busy, setBusy] = useState<Op | null>(null)
  const [copied, setCopied] = useState(false)
  const [instruction, setInstruction] = useState('')
  const alive = useRef(true)

  const run = async (op: Op) => {
    setBusy(op)
    setFailure(null)
    try {
      const answer = await query<ChangelogView>(`changelog/${op}`, { project, milestone, ...(op === 'edit' ? { instruction } : {}) })
      if (!alive.current) return
      setView(answer)
      if (op === 'edit') setInstruction('')
    } catch (error) {
      if (alive.current) setFailure(noticeOf(error))
    } finally {
      if (alive.current) setBusy(null)
    }
  }

  useEffect(() => {
    alive.current = true
    if (dialog.current?.open === false) dialog.current.showModal()
    void run('open')
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  const version = view?.version ?? null
  const missing = version === null || state === null ? 0 : unaccounted(state.tasks, project, milestone, version.tasks).length
  const idle = busy === null

  const copy = async () => {
    if (version === null) return
    try {
      await navigator.clipboard.writeText(version.text)
    } catch {
      // Plain HTTP from another host has no clipboard API: copy the old way, from a field inside the modal dialog.
      const area = document.createElement('textarea')
      area.value = version.text
      dialog.current?.append(area)
      area.select()
      document.execCommand('copy')
      area.remove()
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
          {view !== null && version !== null && (
            <>
              <p className="changelog__counts">{t.changelog.counts(version.tasks.length, version.open)}</p>
              {view.released !== null && <p className="changelog__counts">{t.changelog.released(view.released)}</p>}
              {version.instruction !== null && <p className="changelog__instruction">{t.changelog.instruction(version.instruction)}</p>}
              <Section lines={diffSection(version.base, version.text)} label={t.changelog.title(milestone)} />
              <textarea
                className="changelog__edit"
                rows={2}
                value={instruction}
                placeholder={t.changelog.editHint}
                aria-label={t.changelog.edit}
                disabled={!idle}
                onChange={(event) => setInstruction(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
                  event.preventDefault()
                  if (instruction.trim() !== '') void run('edit')
                }}
              />
            </>
          )}
          {busy !== null && busy !== 'write' && (
            <p className="changelog__writing" role="status">
              {view === null || busy === 'again' ? t.changelog.writing : t.changelog.working}
            </p>
          )}
          {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
        </div>
        <footer className="add-package__foot">
          {view !== null && version !== null && (
            <span className="changelog__at">
              {version.written === null
                ? t.changelog.at(version.number, formatMoment(version.at, new Date()))
                : t.changelog.written(view.file, version.written.commit.slice(0, SHORT_COMMIT))}
            </span>
          )}
          <span className="add-package__spacer" />
          {missing > 0 && (
            <Tipped tip={t.changelog.addTip} inline>
              <button type="button" className="button" disabled={!idle} aria-busy={busy === 'add'} onClick={() => void run('add')}>
                {t.changelog.add(missing)}
              </button>
            </Tipped>
          )}
          <button type="button" className="button" disabled={!idle} aria-busy={busy === 'again'} onClick={() => void run('again')}>
            {t.changelog.again}
          </button>
          <button type="button" className="button" disabled={version === null || !idle} onClick={() => void copy()}>
            {copied ? t.changelog.copied : t.changelog.copy}
          </button>
          <Tipped tip={t.changelog.writeTip(view?.file ?? '')} inline off={view === null}>
            <button
              type="button"
              className="button button--primary"
              disabled={version === null || version.written !== null || !idle}
              aria-busy={busy === 'write'}
              onClick={() => void run('write')}
            >
              {t.changelog.write}
            </button>
          </Tipped>
        </footer>
      </div>
    </dialog>
  )
}

/** The section, line by line: added lines green, removed ones struck through, a changed line with its replaced words marked. */
function Section({ lines, label }: { lines: DiffLine[]; label: string }) {
  return (
    <div className="changelog__text" role="document" aria-label={label} tabIndex={0}>
      {lines.map((line, index) => (
        <div key={index} className={`changelog__line changelog__line--${line.kind}`}>
          {line.pieces.map((piece, at) =>
            piece.kind === 'added' ? (
              <ins key={at}>{piece.text}</ins>
            ) : piece.kind === 'removed' ? (
              <del key={at}>{piece.text}</del>
            ) : (
              <span key={at}>{piece.text}</span>
            ),
          )}
          {line.pieces.every((piece) => piece.text === '') && ' '}
        </div>
      ))}
    </div>
  )
}
