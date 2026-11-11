import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EvenKeelState } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { projectLabel } from '../state.js'
import { Segmented } from '../stats/common.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { Tipped } from '../ui/Tipped.js'
import { gitSwitchBusy } from './gitSwitchBusy.js'
import { PartDot } from './SetupAgent.js'
import { GitInstall, Identity } from './SetupGit.js'
import { Row, Section } from './settingsParts.js'
import '../tools/addPackage.css'
import './projectAdd.css'
import './gitSwitch.css'

type Place = 'worktree' | 'slots'

/** A switch button greyed with the reason in a tip while the project is busy (`gitSwitchBusy`). */
function SwitchButton({ busy, label, danger = false, onClick }: { busy: boolean; label: string; danger?: boolean; onClick: () => void }) {
  const className = danger ? 'button button--small' : 'button'
  if (!busy)
    return (
      <button type="button" className={className} onClick={onClick}>
        {label}
      </button>
    )
  return (
    <Tipped tip={t.settings.gitSwitch.busy} inline>
      <button type="button" className={className} aria-disabled="true">
        {label}
      </button>
    </Tipped>
  )
}

/** The Repository tab's card of a project without git: "Turn on git" and its dialog (BTN-884). */
export function GitOnSection({ state, project }: { state: EvenKeelState | null; project: string }) {
  const [open, setOpen] = useState(false)
  const text = t.settings.gitSwitch
  const busy = state === null || gitSwitchBusy(state, project)
  return (
    <Section title={text.onSection} hint={text.onHint}>
      <div className="account__actions">
        <SwitchButton busy={busy} label={text.on} onClick={() => setOpen(true)} />
      </div>
      {open && state !== null && <GitOnDialog state={state} project={project} onClose={() => setOpen(false)} />}
    </Section>
  )
}

/**
 * Three steps at once, as the project wizard's cards: git on the machine and the name and e-mail — the setup's own Git
 * step parts — then, optional, a folder per task or lasting folders. "Turn on git" stands greyed until git starts and
 * has a name and e-mail.
 */
function GitOnDialog({ state, project, onClose }: { state: EvenKeelState; project: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const title = useId()
  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])
  const { send, sending, failure } = useCommand()
  const [place, setPlace] = useState<Place>('worktree')
  const [slots, setSlots] = useState('1')
  const text = t.settings.gitSwitch
  const git = state.git
  const installed = git !== undefined && git.version !== null
  const named = installed && git.name !== null && git.email !== null
  const count = Number(slots)
  const slotCount = place === 'worktree' ? 0 : Number.isInteger(count) && count >= 1 ? count : null
  const ready = named && slotCount !== null && !gitSwitchBusy(state, project)
  const reason = gitSwitchBusy(state, project) ? text.busy
    : git === undefined ? t.setup.git.checking
    : !installed ? text.needGit
    : !named ? text.needIdentity
    : slotCount === null ? text.needSlots : null
  const turnOn = async () => {
    if (ready && !sending && (await send('project/git', { project, on: true, slot: slotCount }))) onClose()
  }

  return createPortal(
    <dialog
      ref={dialog}
      className="add-package add-package--wide"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      {...backdrop}
    >
      <div className="add-package__frame">
        <header className="add-package__head">
          <h2 id={title} className="add-package__title">
            {text.title(projectLabel(state, project))}
          </h2>
          <button type="button" className="panel__close" aria-label={t.common.cancel} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="add-package__body git-on__body">
          <p className="setup__lead">{text.lead}</p>
          <GitInstall state={state} />
          {installed && <Identity key={`${git.name}\n${git.email}`} git={git} />}
          <Section title={text.place} mark={<PartDot check={slotCount === null ? 'failed' : 'passed'} first />} className="project-add__step">
            <p className="setup__lead">{text.placeLead}</p>
            <Row
              className="settings__field project-add__pick"
              label={t.wizard.place}
              control={
                <Segmented
                  label={t.wizard.place}
                  options={[
                    ['worktree', t.wizard.placeWorktree],
                    ['slots', t.wizard.placeSlots],
                  ]}
                  value={place}
                  onChange={setPlace}
                />
              }
            >
              <span className="settings__hint">{t.wizard.placeHints[place]}</span>
            </Row>
            {place === 'slots' && (
              <Row
                className="settings__field"
                label={t.wizard.placeCount}
                htmlFor="git-on-slots"
                control={
                  <input
                    id="git-on-slots"
                    className="settings__text"
                    autoComplete="off"
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={slots}
                    aria-invalid={slotCount === null}
                    onChange={(event) => setSlots(event.target.value)}
                  />
                }
              />
            )}
          </Section>
        </div>
        {failure !== null && <p role="alert" className="notice notice--error add-package__failure git-on__failure">{say(failure)}</p>}
        <footer className="add-package__foot">
          <span className="add-package__spacer" />
          <button type="button" className="button" disabled={sending} onClick={onClose}>
            {t.common.cancel}
          </button>
          <Tipped tip={reason} off={reason === null} inline>
            <button type="button" className="button button--primary" disabled={sending} aria-disabled={!ready || undefined} onClick={() => void turnOn()}>
              {text.on}
            </button>
          </Tipped>
        </footer>
      </div>
    </dialog>,
    document.body,
  )
}

/** The Repository tab's card of a git project: "Turn off git" behind a confirmation; left task worktrees ask once more. */
export function GitOffSection({ state, project }: { state: EvenKeelState | null; project: string }) {
  const [open, setOpen] = useState(false)
  const text = t.settings.gitSwitch
  const busy = state === null || gitSwitchBusy(state, project)
  return (
    <Section title={text.offSection} hint={text.offHint}>
      <div className="account__actions">
        <SwitchButton busy={busy} label={text.off} danger onClick={() => setOpen(true)} />
      </div>
      {open && state !== null && <GitOffConfirm state={state} project={project} onClose={() => setOpen(false)} />}
    </Section>
  )
}

/** Its own command, so a refusal shown in one opening is gone in the next. */
function GitOffConfirm({ state, project, onClose }: { state: EvenKeelState; project: string; onClose: () => void }) {
  const { send, sending, failure } = useCommand()
  const text = t.settings.gitSwitch
  // The service named the worktrees left with work: the next press turns git off over them.
  const warned = failure?.code === 'project.gitOffWorktrees'
  const turnOff = async () => {
    if (await send('project/git', { project, on: false, force: warned })) onClose()
  }
  return (
    <ConfirmDialog
      title={text.off}
      question={text.offQuestion(projectLabel(state, project))}
      confirm={warned ? text.offAnyway : text.off}
      cancel={t.common.cancel}
      busy={sending}
      failure={failure !== null ? say(failure) : undefined}
      onConfirm={() => void turnOff()}
      onClose={onClose}
    />
  )
}
