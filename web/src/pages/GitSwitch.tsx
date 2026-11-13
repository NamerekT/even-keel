import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EvenKeelState } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { projectLabel } from '../state.js'
import { Segmented } from '../stats/common.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { Tipped } from '../ui/Tipped.js'
import { gitSwitchBusy } from './gitSwitchBusy.js'
import { offeredBranch } from './gitFound.js'
import { PartDot } from './SetupAgent.js'
import { GitInstall, Identity } from './SetupGit.js'
import { Row, Section, Switch } from './settingsParts.js'
import '../tools/addPackage.css'
import './projectAdd.css'
import './gitSwitch.css'

type Place = 'worktree' | 'slots'

/** A switch button greyed with the reason in a tip while the project is busy (`gitSwitchBusy`). */
function SwitchButton({ busy, label, onClick, className = 'button' }: { busy: boolean; label: string; onClick: () => void; className?: string }) {
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

/** "Turn on git" under the notice that the folder has become a repository (BTN-1025): the same dialog as the card's. */
export function GitOnButton({ state, project, className }: { state: EvenKeelState | null; project: string; className: string }) {
  const [open, setOpen] = useState(false)
  const busy = state === null || gitSwitchBusy(state, project)
  return (
    <>
      <SwitchButton busy={busy} label={t.settings.gitSwitch.on} className={className} onClick={() => setOpen(true)} />
      {open && state !== null && <GitOnDialog state={state} project={project} onClose={() => setOpen(false)} />}
    </>
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
  const read = useGitChanges(project)
  // A refusal for changes the press found carries the fresh list (BTN-1054): it stands over the one read at opening.
  const files = failure?.code === 'project.gitDirty' ? failure.params.files : read
  const [commit, setCommit] = useState(true)
  const offered = offeredBranch(state, project)
  const [take, setTake] = useState(true)
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
    const branch = offered !== null && take ? { branch: offered.current } : {}
    if (ready && !sending && (await send('project/git', { project, on: true, slot: slotCount, commit, ...branch }))) onClose()
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
          {offered !== null && <BranchChoice {...offered} take={take} onTake={setTake} />}
          {files.length > 0 && <GitChanges files={files} commit={commit} onCommit={setCommit} />}
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
        {failure !== null && <p role="alert" className="notice notice--error add-package__failure">{say(failure)}</p>}
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

const SHOWN_CHANGES = 20

/** The uncommitted changes of a repository with commits, read once the dialog opens; none until read or when it fails. */
function useGitChanges(project: string): string[] {
  const { query } = useLive()
  const [files, setFiles] = useState<string[]>([])
  useEffect(() => {
    let live = true
    query<{ files: string[] }>('project/git/changes', { project }).then(
      (read) => live && setFiles(read.files),
      () => live && setFiles([]),
    )
    return () => {
      live = false
    }
  }, [project])
  return files
}

/**
 * The branch of a repository the agent made against the project's main branch (BTN-1025): ticked, the project takes
 * the repository's; unticked, the repository needs the project's, or the switch is refused with `git.noBranch`.
 */
function BranchChoice({ current, main, take, onTake }: { current: string; main: string; take: boolean; onTake: (take: boolean) => void }) {
  const text = t.settings.gitSwitch
  return (
    <Section title={text.branch} mark={<PartDot check="passed" first />} className="project-add__step">
      <p className="setup__lead">{text.branchLead(current, main)}</p>
      <Row className="git-on__commit" label={text.takeBranch(current)} htmlFor="git-on-branch" control={<Switch id="git-on-branch" checked={take} onChange={onTake} />}>
        <span className="settings__hint">{take ? text.takeHint : text.keepHint(main)}</span>
      </Row>
    </Section>
  )
}

/** Work done in the repository outside git (BTN-1054): the first lines of it and whether it goes into one commit. */
function GitChanges({ files, commit, onCommit }: { files: string[]; commit: boolean; onCommit: (commit: boolean) => void }) {
  const text = t.settings.gitSwitch
  const shown = files.slice(0, SHOWN_CHANGES)
  return (
    <Section title={text.changes} mark={<PartDot check={commit ? 'passed' : 'failed'} first />} className="project-add__step">
      <p className="setup__lead">{text.changesLead(files.length)}</p>
      <ul className="git-on__files">
        {shown.map((file) => (
          <li key={file}>{file}</li>
        ))}
        {files.length > shown.length && <li className="git-on__more">{text.changesMore(files.length - shown.length)}</li>}
      </ul>
      <Row className="git-on__commit" label={text.commit} htmlFor="git-on-commit" control={<Switch id="git-on-commit" checked={commit} onChange={onCommit} />}>
        <span className="settings__hint">{commit ? text.commitHint : text.noCommitHint}</span>
      </Row>
    </Section>
  )
}
