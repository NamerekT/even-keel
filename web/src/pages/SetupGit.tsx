import { useState } from 'react'
import type { EvenKeelState, GitSetupView, WindowsStart } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { CommandBlock } from '../ui/blocks.js'
import { PartDot } from './SetupAgent.js'
import { Row, Section } from './settingsParts.js'
import { Cards, type Save } from './SetupChoices.js'
import { gitChoice, gitDownload } from './setupSteps.js'
import { Status } from './TrackerFields.js'
import '../layout/cliCopies.css'

interface StepProps {
  state: EvenKeelState
  save: Save
  sending: boolean
  /** "No" was picked: the setup goes on. */
  onPicked: () => void
}

/**
 * The setup's Git step: first "Use git?" (BTN-886), its answer the `defaultGit` setting the project wizard starts from;
 * "No" goes on at once and asks nothing of git. "Yes" (BTN-731): whether git starts from the service; where it does
 * not, the command of the package manager the service found and always the download link (EKR-54); then the name and
 * e-mail its commits are made as, written into git's global config. Git itself is never installed.
 */
export function GitStep({ state, save, sending, onPicked }: StepProps) {
  const choice = gitChoice(state.config.shared.defaultGit, state.git)
  const text = t.setup.git
  const pick = async (on: boolean) => {
    if ((await save({ defaultGit: on })) && !on) onPicked()
  }
  return (
    <>
      <Section title={text.question} mark={<PartDot check={choice === null ? 'empty' : 'passed'} first />} className="project-add__step">
        <Cards
          items={(['yes', 'no'] as const).map((each) => ({ id: each, title: text.choices[each], hint: text.choiceHints[each] }))}
          chosen={choice === null ? '' : choice ? 'yes' : 'no'}
          disabled={sending}
          onPick={(value) => void pick(value === 'yes')}
        />
      </Section>
      {choice === true && <GitCheck state={state} />}
    </>
  )
}

/** Whether git starts, how to install it, and the name and e-mail of its commits. */
function GitCheck({ state }: { state: EvenKeelState }) {
  const git = state.git
  return (
    <>
      <GitInstall state={state} />
      {git !== undefined && git.version !== null && <Identity key={`${git.name}\n${git.email}`} git={git} />}
    </>
  )
}

/** Whether git starts from the service and, where not, how to install it; also the first step of turning git on for a project (BTN-884). */
export function GitInstall({ state }: { state: EvenKeelState }) {
  const { send, sending, failure } = useCommand()
  const git = state.git
  const text = t.setup.git
  const installed = git !== undefined && git.version !== null
  const command = git?.install
  const download = (label: string) => (
    <a href={gitDownload(state.platform)} target="_blank" rel="noreferrer">
      {label}
    </a>
  )
  return (
    <Section title={t.setup.titles.git} mark={<PartDot check={git === undefined ? 'empty' : installed ? 'passed' : 'failed'} first />} className="project-add__step">
      <p className="setup__lead">{text.lead}</p>
      {git === undefined && <p className="setup-account__note">{text.checking}</p>}
      {installed && <Status ok>{text.installed(git.version!)}</Status>}
      {git !== undefined && !installed && (
        <>
          <Status>{text.absent}</Status>
          {git.restart !== undefined && <p className="setup-account__note">{restartHint(git.restart)}</p>}
          <div className="setup-git__commands">
            {/* "Check again" stands beside the first line, the command or the link alone, not beside both. */}
            <div className="cli-source__install">
              {command !== undefined ? <CommandBlock command={command} /> : <span>{download(text.downloadOnly)}</span>}
              <button type="button" className="button button--small" disabled={sending} onClick={() => void send('git/check')}>
                {text.again}
              </button>
            </div>
            {state.platform === 'darwin' && <p className="setup-account__note">{text.macTools}</p>}
            {command !== undefined && download(text.download)}
          </div>
        </>
      )}
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
    </Section>
  )
}

/**
 * What makes Even Keel on Windows see a git installed since it started (EKR-57): the tray and a service read `PATH`
 * anew on a restart and check git at the start, a terminal keeps its own `PATH`.
 */
function restartHint(start: WindowsStart): string {
  const text = t.setup.git
  if (start.by === 'tray') return text.restartTray
  return start.by === 'service' ? text.restartService(start.name) : text.restartConsole
}

/** Two fields filled with what git has, and "Save" once both are filled and one of them changed; keyed by them where shown. */
export function Identity({ git }: { git: GitSetupView }) {
  const { send, sending, failure } = useCommand()
  const [name, setName] = useState(git.name ?? '')
  const [email, setEmail] = useState(git.email ?? '')
  const text = t.setup.git
  const set = git.name !== null && git.email !== null
  const changed = name.trim() !== (git.name ?? '') || email.trim() !== (git.email ?? '')
  const filled = name.trim() !== '' && email.trim() !== ''
  return (
    <Section title={text.identity} mark={<PartDot check={set ? 'passed' : 'empty'} first />} className="project-add__step">
      <p className="setup__lead">{text.identityLead}</p>
      <Row
        className="settings__field"
        label={text.name}
        htmlFor="setup-git-name"
        control={<input id="setup-git-name" className="settings__text" value={name} placeholder="John Doe" autoComplete="name" onChange={(event) => setName(event.target.value)} />}
      />
      <Row
        className="settings__field"
        label={text.email}
        htmlFor="setup-git-email"
        control={
          <input id="setup-git-email" className="settings__text" type="email" value={email} placeholder="john@example.com" autoComplete="email" onChange={(event) => setEmail(event.target.value)} />
        }
      />
      <div className="setup-git__save">
        {!set && <Status>{text.identityMissing}</Status>}
        <button type="button" className="button" disabled={sending || !changed || !filled} onClick={() => void send('git/identity', { name, email })}>
          {text.save}
        </button>
      </div>
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
    </Section>
  )
}
