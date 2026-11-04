import { useState } from 'react'
import type { EvenKeelState, GitSetupView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { CommandBlock } from '../ui/blocks.js'
import { PartDot } from './SetupAgent.js'
import { Row, Section } from './settingsParts.js'
import { gitDownload } from './setupSteps.js'
import { Status } from './TrackerFields.js'
import '../layout/cliCopies.css'

/**
 * The setup's Git step (BTN-731): whether git starts from the service; where it does not, the command of the package
 * manager the service found and always the download link (EKR-54); then the name and e-mail its commits are made as,
 * written into git's global config. Git itself is never installed.
 */
export function GitStep({ state }: { state: EvenKeelState }) {
  const { send, sending, failure } = useCommand()
  const git = state.git
  const text = t.setup.git
  const installed = git !== undefined && git.version !== null
  const command = git?.install
  return (
    <>
      <Section title={t.setup.titles.git} mark={<PartDot check={git === undefined ? 'empty' : installed ? 'passed' : 'failed'} first />} className="project-add__step">
        <p className="setup__lead">{text.lead}</p>
        {git === undefined && <p className="setup-account__note">{text.checking}</p>}
        {installed && <Status ok>{text.installed(git.version!)}</Status>}
        {git !== undefined && !installed && (
          <>
            <Status>{text.absent}</Status>
            {state.platform === 'win32' && <p className="setup-account__note">{text.windowsRestart}</p>}
            <div className="cli-source__install">
              <div className="setup-git__commands">
                {command !== undefined && <CommandBlock command={command} />}
                <a href={gitDownload(state.platform)} target="_blank" rel="noreferrer">
                  {command !== undefined ? text.download : text.downloadOnly}
                </a>
              </div>
              <button type="button" className="button button--small" disabled={sending} onClick={() => void send('git/check')}>
                {text.again}
              </button>
            </div>
          </>
        )}
        {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      </Section>
      {installed && <Identity key={`${git.name}\n${git.email}`} git={git} />}
    </>
  )
}

/** Two fields filled with what git has, and "Save" once both are filled and one of them changed. */
function Identity({ git }: { git: GitSetupView }) {
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
