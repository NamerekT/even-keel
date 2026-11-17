import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { PoolMachine, ProjectPool } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { Segmented } from '../stats/common.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { Select } from '../ui/Select.js'
import '../tools/addPackage.css'

type Mode = 'folder' | 'clone'

/**
 * "Connect a machine" of a project's section "Machines" (BTN-1271): a machine of the hub not in the pool, and its folder
 * of the project — one already there, or a clone made now. The checks run as a job in its own window; the hub's own
 * machine needs none and is only turned on.
 */
export function ConnectMachineDialog({
  project,
  others,
  pooled = [],
  onClose,
  onStarted,
}: {
  project: string
  others: ProjectPool['others']
  /** The pool's machines: one elsewhere with values of its own in the project may give them to the new one (BTN-994). */
  pooled?: PoolMachine[]
  onClose: () => void
  onStarted: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const machineId = useId()
  const pathId = useId()
  const copyId = useId()
  const sources = pooled.filter((each) => !each.own && Object.keys(each.settings).length > 0)
  const [copyFrom, setCopyFrom] = useState('')
  const { send, sending, failure } = useCommand()
  const [machine, setMachine] = useState(others[0]?.id ?? '')
  const chosen = others.find((each) => each.id === machine)
  // The hub's own machine has no folder to name: its folder is the project's repository.
  const own = chosen?.own === true
  const [mode, setMode] = useState<Mode>('folder')
  const [path, setPath] = useState(chosen?.folder ?? '')
  const backdrop = useBackdropClose(dialog, onClose)

  useLayoutEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

  const pick = (id: string) => {
    setMachine(id)
    setPath(others.find((each) => each.id === id)?.folder ?? '')
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (chosen === undefined || sending) return
    const started = own
      ? await send('machines/enable', { project, machine, enabled: true })
      : await send('machines/connect', { project, machine, clone: mode === 'clone', folder: path.trim(), ...(copyFrom !== '' && { copyFrom }) })
    if (started) onStarted()
  }

  // Out of the settings' form: a form inside a form is invalid, and its submit would save the settings.
  return createPortal(
    <dialog
      ref={dialog}
      className="add-package connect-machine"
      aria-labelledby={heading}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        onClose()
      }}
      {...backdrop}
    >
      <form className="add-package__frame add-package__form" onSubmit={(event) => void submit(event)}>
        <header className="add-package__head">
          <h2 id={heading} className="add-package__title">
            {t.pool.dialog.title}
          </h2>
          <button type="button" className="panel__close" aria-label={t.common.close} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="add-package__body">
          <div className="add-package__field">
            <label className="add-package__label" htmlFor={machineId}>
              {t.pool.dialog.machine}
            </label>
            <Select
              id={machineId}
              className="add-package__input"
              value={machine}
              options={others.map((each) => ({ value: each.id, label: each.online ? each.name : `${each.name} · ${t.pool.offline}` }))}
              onChange={pick}
            />
          </div>
          {own ? (
            <p className="add-package__note">{t.pool.dialog.ownNote}</p>
          ) : (
            <>
              <div className="add-package__field">
                <span className="add-package__label">{t.pool.dialog.mode}</span>
                <Segmented
                  label={t.pool.dialog.mode}
                  options={[
                    ['folder', t.pool.dialog.folder],
                    ['clone', t.pool.dialog.clone],
                  ]}
                  value={mode}
                  onChange={setMode}
                />
              </div>
              <div className="add-package__field">
                <label className="add-package__label" htmlFor={pathId}>
                  {t.pool.dialog.path}
                </label>
                <input
                  id={pathId}
                  className="add-package__input settings__text--mono"
                  autoComplete="off"
                  spellCheck={false}
                  value={path}
                  placeholder={chosen?.folder ?? ''}
                  onChange={(event) => setPath(event.target.value)}
                />
                <p className="add-package__note">{mode === 'clone' ? t.pool.dialog.cloneHint : t.pool.dialog.pathHint}</p>
              </div>
              {sources.length > 0 && (
                <div className="add-package__field">
                  <label className="add-package__label" htmlFor={copyId}>
                    {t.pool.dialog.copy}
                  </label>
                  <Select
                    id={copyId}
                    className="add-package__input"
                    value={copyFrom}
                    options={[{ value: '', label: t.pool.dialog.copyNone }, ...sources.map((each) => ({ value: each.id, label: t.pool.dialog.copyFrom(each.name) }))]}
                    onChange={setCopyFrom}
                  />
                  <p className="add-package__note">{t.pool.dialog.copyHint}</p>
                </div>
              )}
              <p className="add-package__note">{t.pool.dialog.checks}</p>
            </>
          )}
        </div>
        {failure !== null && (
          <p role="alert" className="notice notice--error add-package__failure">
            {say(failure)}
          </p>
        )}
        <footer className="add-package__foot">
          <span className="add-package__spacer" />
          <button type="button" className="button" onClick={onClose}>
            {t.pool.dialog.cancel}
          </button>
          <button type="submit" className="button button--primary" disabled={chosen === undefined || sending} aria-busy={sending || undefined}>
            {t.pool.dialog.submit}
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  )
}
