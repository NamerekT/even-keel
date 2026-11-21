import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { PoolMachine, ProjectPool } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { Select, type SelectOption } from '../ui/Select.js'
import { folderBlocked, lastFolder, machineFolder, NEW_FOLDER, type FolderPick } from './machinePicks.js'
import { MachineFolderField, useFolderAnswers } from './MachineFolderField.js'
import '../tools/addPackage.css'
import { CloseIcon } from '../ui/icons.js'
import './projectMachines.css'

/** A machine as the pick lists it: its name, and one off the link marked by a hollow lamp whose tip says so (BTN-1381). */
export function machineOption(machine: Pick<ProjectPool['others'][number], 'id' | 'name' | 'online'>): SelectOption {
  if (machine.online) return { value: machine.id, label: machine.name }
  return {
    value: machine.id,
    label: machine.name,
    aside: <span className="pool__lamp" role="img" aria-label={t.pool.offline} title={t.pool.offline} />,
    keywords: t.pool.offline,
  }
}

/**
 * "Connect a machine" of a project's section "Machines" (BTN-1271): a machine of the hub not in the pool, and its folder
 * of the project — free, and the project is cloned there, or holding its clone, taken as it is (BTN-1298). The checks
 * run as a job in its own window; the hub's own machine needs none and is only turned on.
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
  const copyId = useId()
  const sources = pooled.filter((each) => !each.own && Object.keys(each.settings).length > 0)
  const [copyFrom, setCopyFrom] = useState('')
  const { send, sending, failure } = useCommand()
  const [machine, setMachine] = useState(others[0]?.id ?? '')
  const chosen = others.find((each) => each.id === machine)
  // The hub's own machine has no folder to name: its folder is the project's repository.
  const own = chosen?.own === true
  const [place, setPlace] = useState<FolderPick>(NEW_FOLDER)
  const hubName = lastFolder(chosen?.folder ?? '')
  const folder = chosen === undefined || own ? null : machineFolder(place, chosen, hubName)
  const probe = useFolderAnswers(folder === null ? [] : [{ id: machine, machine, folder, project }])[machine]
  // The folder decides between a clone and a clone already there (BTN-1298): one taken holds "Connect".
  const blocked = chosen === undefined || (!own && folderBlocked(place, chosen, probe))
  const backdrop = useBackdropClose(dialog, onClose)

  useLayoutEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

  const pick = (id: string) => {
    setMachine(id)
    setPlace(NEW_FOLDER)
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (blocked || sending) return
    const started = own
      ? await send('machines/enable', { project, machine, enabled: true })
      : await send('machines/connect', { project, machine, ...(folder !== null && { folder }), ...(copyFrom !== '' && { copyFrom }) })
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
            <CloseIcon />
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
              options={others.map(machineOption)}
              onChange={pick}
            />
          </div>
          {own ? (
            <p className="add-package__note">{t.pool.dialog.ownNote}</p>
          ) : (
            <>
              <div className="add-package__field">
                <span className="add-package__label">{t.pool.dialog.folder}</span>
                {chosen !== undefined && (
                  <div className="machine-folder">
                    <MachineFolderField
                      labels={{ folder: t.pool.wizard.folderOf(chosen.name), path: t.pool.wizard.pathOf(chosen.name) }}
                      root={chosen.root}
                      pick={place}
                      hubName={hubName}
                      probe={probe}
                      onChange={(patch) => setPlace({ ...place, ...patch })}
                    />
                  </div>
                )}
                <p className="add-package__note">{t.pool.dialog.pathHint}</p>
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
          <button type="submit" className="button button--primary" disabled={blocked || sending} aria-busy={sending || undefined}>
            {t.pool.dialog.submit}
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  )
}
