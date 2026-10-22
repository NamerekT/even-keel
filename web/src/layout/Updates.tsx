import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import Markdown, { type Components } from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import type { UpdateResultView } from '../../../src/updates/model.js'
import type { ReleaseNote, UpdatesView } from '../../../src/updates/release.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { Toast } from '../ui/Toast.js'
import '../tools/addPackage.css'
import '../ui/markdown.css'
import './updates.css'

const listeners = new Set<() => void>()
let windowOpen = false

function setWindow(open: boolean) {
  windowOpen = open
  for (const listener of listeners) listener()
}

/** The update window is one for the page: the gear menu, the burger's sheet and the toasts all open it. */
export const openUpdateWindow = () => setWindow(true)

function useWindowOpen() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => windowOpen,
  )
}

/** The last row of the gear menu and the burger's sheet: the installed version, and a newer release or the way back when there is one. */
export function VersionRow() {
  const { state } = useLive()
  if (state === null) return null
  const { current, available, previous } = state.updates
  return (
    <div className="gear__version">
      <span>{t.updates.version(current)}</span>
      {available !== null ? (
        <button type="button" className="gear__update" title={t.updates.openTitle} onClick={openUpdateWindow}>
          {t.updates.available(available.version)}
        </button>
      ) : (
        previous !== null && (
          <button type="button" className="gear__update gear__update--back" onClick={openUpdateWindow}>
            {t.updates.back(previous.version)}
          </button>
        )
      )}
    </div>
  )
}

/** The toast about a newer release; its buttons are kept by the service, so every device stops showing it. */
export function UpdateToast() {
  const { state } = useLive()
  const { send } = useCommand()
  const [hidden, setHidden] = useState<string | null>(null)
  const updates = state?.updates
  const available = updates?.available ?? null
  if (updates === undefined || !updates.toast || available === null || updates.progress !== null || hidden === available.version) return null

  const hide = (command: string, body?: Record<string, unknown>) => {
    setHidden(available.version)
    void send(command, body).then((done) => {
      if (!done) setHidden(null)
    })
  }
  return (
    <Toast
      source="Even Keel"
      icon="/favicon.svg"
      title={t.updates.toastTitle(available.version)}
      body={t.updates.toastBody(updates.current)}
      href={available.url}
      actions={[
        { label: t.updates.open, onClick: openUpdateWindow },
        { label: t.updates.mute, onClick: () => hide('updates/mute') },
        { label: t.updates.close, onClick: () => hide('updates/dismiss', { version: available.version }) },
      ]}
    />
  )
}

/**
 * An update or a revert under way. The service goes down in the middle, so the page reloads itself once it answers
 * with another version: the new code is in the bundle it serves.
 */
export function UpdateProgressToast() {
  const { state } = useLive()
  const first = useRef<string | null>(null)
  const current = state?.updates.current ?? null

  useEffect(() => {
    if (current === null) return
    if (first.current === null) first.current = current
    else if (first.current !== current) location.reload()
  }, [current])

  const progress = state?.updates.progress ?? null
  if (progress === null) return null
  return (
    <Toast
      source="Even Keel"
      icon="/favicon.svg"
      title={
        progress.phase === 'settling' && progress.waiting.length > 0
          ? t.updates.progressSettling(progress.mode, progress.target, progress.waiting)
          : t.updates.progressRunning(progress.mode, progress.target)
      }
      body={t.updates.progressBody}
      actions={[]}
    />
  )
}

/** How the last update or revert ended, shown after the restart until the user closes it. */
export function UpdateResultToast() {
  const { state } = useLive()
  const { send } = useCommand()
  const [hidden, setHidden] = useState(false)
  const result = state?.updates.result ?? null
  if (result === null || hidden) return null

  const close = () => {
    setHidden(true)
    void send('updates/seen').then((done) => {
      if (!done) setHidden(false)
    })
  }
  return (
    <Toast
      source="Even Keel"
      icon="/favicon.svg"
      title={resultTitle(result)}
      body={resultBody(result)}
      actions={[...(result.step === null ? [] : [{ label: t.updates.details, onClick: openUpdateWindow }]), { label: t.updates.close, onClick: close }]}
    />
  )
}

function resultTitle(result: UpdateResultView): string {
  const version = result.to ?? result.from
  return result.step === null ? t.updates.resultDone(result.mode, version) : t.updates.resultFailed(result.mode, version)
}

function resultBody(result: UpdateResultView): string {
  if (result.step === null) return t.updates.resultDoneBody(result.from)
  const rollbackStep = result.rollbackStep === null ? '' : t.updates.steps[result.rollbackStep]
  return t.updates.resultBody(t.updates.steps[result.step], result.rollback, result.from, rollbackStep)
}

/** The update window: the versions, the notes of every newer release, "Update", and "Revert" or why there is none. */
export function UpdateWindow() {
  const { state } = useLive()
  const open = useWindowOpen()
  if (state === null || !open) return null
  return <UpdateDialog updates={state.updates} />
}

function UpdateDialog({ updates }: { updates: UpdatesView }) {
  const { send, sending, failure } = useCommand()
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  const { current, available, notes, blocked, previous, progress, result } = updates
  const busy = sending || progress !== null

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  })

  const close = () => setWindow(false)
  const run = (command: string) => void send(command).then((done) => done && close())

  return (
    <dialog
      ref={dialog}
      className="add-package update-window"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
    >
      <div className="add-package__frame">
        <header className="add-package__head">
          <h2 id={title} className="add-package__title">
            {t.updates.windowTitle}
          </h2>
          <button type="button" className="panel__close" aria-label={t.updates.close} onClick={close}>
            ×
          </button>
        </header>
        <div className="add-package__body">
          <dl className="update-window__versions">
            <dt>{t.updates.installed}</dt>
            <dd>{current}</dd>
            {available !== null && (
              <>
                <dt>{t.updates.latest}</dt>
                <dd>{available.version}</dd>
              </>
            )}
          </dl>
          {result !== null && <ResultPart result={result} />}
          {available === null && <p className="update-window__muted">{t.updates.upToDate}</p>}
          {notes.length > 0 && (
            <section className="update-window__notes" aria-label={t.updates.changes}>
              {notes.map((note) => (
                <NotePart key={note.tag} note={note} />
              ))}
            </section>
          )}
          {available !== null && <p className="update-window__muted">{blocked === null ? t.updates.updateHint : t.updates.blocked[blocked]}</p>}
          {previous !== null && (
            <section className="update-window__previous">
              <h3>
                {t.updates.previous}: {previous.version}
              </h3>
              <p className="update-window__muted">
                {previous.blocked === null
                  ? t.updates.revertHint(previous.version)
                  : previous.blocked === 'storage'
                    ? t.updates.revertStorage(previous.version)
                    : t.updates.blocked[previous.blocked]}
              </p>
            </section>
          )}
          {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
        </div>
        {(available !== null && blocked === null) || previous?.blocked === null ? (
          <footer className="add-package__foot">
            {previous !== null && previous.blocked === null && (
              <button type="button" className="button" disabled={busy} onClick={() => run('updates/revert')}>
                {t.updates.revert(previous.version)}
              </button>
            )}
            <span className="add-package__spacer" />
            {available !== null && blocked === null && (
              <button type="button" className="button button--primary" disabled={busy} onClick={() => run('updates/install')}>
                {t.updates.update(available.version)}
              </button>
            )}
          </footer>
        ) : null}
      </div>
    </dialog>
  )
}

function NotePart({ note }: { note: ReleaseNote }) {
  return (
    <article className="update-window__note">
      <header className="update-window__note-head">
        <h3>{note.version}</h3>
        <a href={note.url} target="_blank" rel="noreferrer">
          {t.updates.onGithub}
        </a>
      </header>
      {note.reverted !== null && (
        <div className="notice notice--warn update-window__reverted">
          <strong>{t.updates.reverted}.</strong> {t.updates.revertedBody}
          {note.reverted !== '' && <Text>{note.reverted}</Text>}
        </div>
      )}
      {note.body === '' ? <p className="update-window__muted">{t.updates.noNotes}</p> : <Text>{note.body}</Text>}
    </article>
  )
}

function ResultPart({ result }: { result: UpdateResultView }) {
  return (
    <section className={`notice ${result.step === null ? 'update-window__result--ok' : 'notice--error'} update-window__result`}>
      <strong>{resultTitle(result)}</strong>
      <span>{resultBody(result)}</span>
      {result.output !== '' && (
        <details>
          <summary>{t.updates.output}</summary>
          <pre className="update-window__output">{result.output}</pre>
        </details>
      )}
      {result.step !== null && <span className="update-window__muted">{t.updates.log}</span>}
    </section>
  )
}

const LINKS: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
}

function Text({ children }: { children: string }) {
  return (
    <div className="markdown update-window__markdown">
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={LINKS}>
        {children}
      </Markdown>
    </div>
  )
}
