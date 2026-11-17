import { useState } from 'react'
import { CLAUDE } from '../../../src/claude/name.js'
import type { EvenKeelState, MachineView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { machineAccounts, machineChecks, osLabel, signInOf, type MachineCheck } from '../machineAdd.js'
import { machineLogin } from '../machineSignIn.js'
import { projectName } from '../state.js'
import { SectionLabel } from '../ui/blocks.js'
import { BangIcon, CheckIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import { MachineTokenDialog, type MachineTokenTarget } from './MachineTokenDialog.js'

const agentName = (agent: string): string => t.account.agents[agent as keyof typeof t.account.agents] ?? agent

/** A check as its row reads: what was found, and what follows when it is missing. */
function checkText(check: MachineCheck): { text: string; effect?: string } {
  const text = t.machines
  if (check.id === 'node') {
    const { version } = check as Extract<MachineCheck, { id: 'node' }>
    return check.ok ? { text: text.node(version) } : { text: text.nodeOld(version), effect: text.nodeOldEffect }
  }
  if (check.id === 'git') {
    const { version, user } = check as Extract<MachineCheck, { id: 'git' }>
    if (version === null) return { text: text.gitMissing, effect: text.gitMissingEffect }
    return user ? { text: `${text.git(version)} · ${text.gitUser}` } : { text: `${text.git(version)} · ${text.gitNoUser}`, effect: text.gitNoUserEffect }
  }
  const { agent, version } = check as Extract<MachineCheck, { agent: string }>
  return check.ok ? { text: text.agent(agentName(agent), version) } : { text: text.agentMissing(agentName(agent)), effect: text.agentMissingEffect(agentName(agent)) }
}

interface MachineJoinedProps {
  state: EvenKeelState
  machine: MachineView
  onClose: () => void
}

/**
 * The machine that joined: what it reported, the projects to connect it to (cloned into its folder of projects) and
 * the hub's accounts to sign in to there. The sign-in itself runs in `MachineLoginDialog`, over this window.
 */
export function MachineJoined({ state, machine, onClose }: MachineJoinedProps) {
  const { send, sending, failure } = useCommand()
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(machine.projects))
  const hubAgents = [...new Set(state.account.accounts.map((entry) => entry.agent))]
  const about = machine.about
  const signIn = signInOf(machine, state.machineSignIns, hubAgents)
  const accounts = machineAccounts(state.account.accounts, signIn)
  const fresh = [...chosen].filter((project) => !machine.projects.includes(project))
  const busy = sending || machineLogin(state.machineSignIns) !== undefined
  const [token, setToken] = useState<MachineTokenTarget | null>(null)

  const toggle = (project: string, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current)
      if (on) next.add(project)
      else next.delete(project)
      return next
    })
  const connect = async () => {
    if (await send('machines/projects', { machine: machine.id, projects: fresh })) onClose()
  }

  return (
    <>
      <div className="add-package__body add-machine__appear">
        <p className={`add-machine__joined${machine.online ? '' : ' add-machine__joined--off'}`}>
          <span className="add-machine__lamp" aria-hidden="true" />
          <strong>{t.machines.joined(machine.name)}</strong>
          {about !== null && <span className="add-machine__about">{t.machines.joinedAbout(osLabel(about.os), about.evenKeel)}</span>}
          {!machine.online && <span className="add-machine__about">{t.machines.offline}</span>}
        </p>

        {about !== null && (
          <section className="add-machine__section">
            <SectionLabel>{t.machines.onMachine}</SectionLabel>
            <ul className="add-machine__list">
              {machineChecks(about, hubAgents).map((check) => {
                const { text, effect } = checkText(check)
                return (
                  <li key={check.id} className="add-machine__row">
                    <span className={`add-machine__mark add-machine__mark--${check.ok ? 'ok' : 'warn'}`}>{check.ok ? <CheckIcon /> : <BangIcon />}</span>
                    <span className="add-machine__fact">{text}</span>
                    {effect !== undefined && <span className="add-machine__effect">— {effect}</span>}
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <section className="add-machine__section">
          <SectionLabel>{t.machines.projects}</SectionLabel>
          {about?.root == null ? (
            <p className="add-package__note add-package__note--warn">{t.machines.noRoot}</p>
          ) : state.projects.length === 0 ? (
            <p className="add-package__note">{t.machines.projectsNone}</p>
          ) : (
            <ul className="add-machine__list">
              {state.projects.map((project) => {
                const attached = machine.projects.includes(project)
                const on = chosen.has(project)
                return (
                  <li key={project}>
                    <label className="add-machine__row add-machine__row--pick">
                      <input type="checkbox" checked={on} disabled={attached || sending} onChange={(event) => toggle(project, event.target.checked)} />
                      <span className="add-machine__fact">
                        <span className="add-machine__key">{state.projectKeys[project] ?? project}</span> <span className="add-machine__muted">{projectName(state, project)}</span>
                      </span>
                      <span className="add-machine__effect">{attached ? t.machines.attached : on ? t.machines.intoRoot : t.machines.skip}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="add-machine__section">
          <SectionLabel>{t.machines.accounts}</SectionLabel>
          {accounts.length === 0 ? (
            <p className="add-package__note">{t.machines.accountsNone}</p>
          ) : (
            <ul className="add-machine__list">
              {accounts.map(({ entry, gap, token: onToken }) => (
                <li key={entry.key} className="add-machine__row">
                  <span className="add-machine__fact">
                    {entry.status?.email} <span className="add-machine__muted">{agentName(entry.agent)}</span>
                  </span>
                  {gap === null ? (
                    <span className="add-machine__done">
                      <CheckIcon /> {t.machines.signedIn}
                      {onToken === true && (
                        <Tipped className="add-machine__muted" tip={t.account.machineOnTokenTip(machine.name)} align="end" inline focusable>
                          {' · '}
                          {t.account.machineOnToken}
                        </Tipped>
                      )}
                    </span>
                  ) : gap.noCli ? (
                    <span className="add-machine__effect">{t.machines.noCli(agentName(entry.agent))}</span>
                  ) : signIn.online ? (
                    <span className="add-machine__actions">
                      {entry.agent === CLAUDE && (
                        <Tipped tip={t.account.machineTokenTip} align="end" inline>
                          <button
                            type="button"
                            className="button button--small"
                            disabled={busy}
                            onClick={() => setToken({ machine: machine.id, name: machine.name, account: entry.key, who: entry.status?.email ?? entry.key })}
                          >
                            {t.account.machineToken}
                          </button>
                        </Tipped>
                      )}
                      <button
                        type="button"
                        className="button button--small"
                        disabled={busy}
                        onClick={() => void send('machines/login', { machine: machine.id, agent: entry.agent, ...(gap.account !== undefined && { account: gap.account }) })}
                      >
                        {t.machines.signIn}
                      </button>
                    </span>
                  ) : (
                    <Tipped tip={t.machines.offlineTip(machine.name)} align="end">
                      <button type="button" className="button button--small" aria-disabled="true">
                        {t.machines.signIn}
                      </button>
                    </Tipped>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {failure !== null && (
        <p role="alert" className="notice notice--error add-package__failure">
          {say(failure)}
        </p>
      )}
      <footer className="add-package__foot add-package__foot--wrap">
        <span className="add-package__note add-machine__foot-note">{t.machines.accountsNote}</span>
        <span className="add-package__spacer" />
        <button type="button" className="button" onClick={onClose}>
          {t.machines.later}
        </button>
        <button type="button" className="button button--primary" disabled={fresh.length === 0 || sending} onClick={() => void connect()}>
          {t.machines.connect}
        </button>
      </footer>
      {token !== null && <MachineTokenDialog target={token} onClose={() => setToken(null)} />}
    </>
  )
}
