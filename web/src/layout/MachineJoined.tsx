import { useState } from 'react'
import { CLAUDE } from '../../../src/claude/name.js'
import { JOIN_KIND, stepOf } from '../../../src/jobs/model.js'
import type { EvenKeelState, MachineView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { joinRequests, machineAccounts, machineChecks, osLabel, signInOf, type MachineCheck } from '../machineAdd.js'
import { machineLogin } from '../machineSignIn.js'
import { JobWindow } from '../pages/JobWindow.js'
import { MachineFolderField, useFolderAnswers } from '../pages/MachineFolderField.js'
import { folderBlocked, lastFolder, machineFolder, NEW_FOLDER, type FolderPick } from '../pages/machinePicks.js'
import { projectLabel, projectName } from '../state.js'
import { SectionLabel } from '../ui/blocks.js'
import { BangIcon, CheckIcon } from '../ui/icons.js'
import { HelpTip } from '../pages/settingsParts.js'
import { Tipped } from '../ui/Tipped.js'
import { MachineTokenDialog, type MachineTokenTarget } from './MachineTokenDialog.js'

const agentName = (agent: string): string => t.account.agents[agent as keyof typeof t.account.agents] ?? agent

/**
 * A check as its row reads: what was found, a detail of it for its tip (git's name and e-mail, BTN-1381), and what
 * follows when it is missing; the machine's page reads it too.
 */
export function checkText(check: MachineCheck): { text: string; tip?: string; effect?: string } {
  const text = t.machines
  if (check.id === 'node') {
    const { version } = check as Extract<MachineCheck, { id: 'node' }>
    return check.ok ? { text: text.node(version) } : { text: text.nodeOld(version), effect: text.nodeOldEffect }
  }
  if (check.id === 'git') {
    const { version, user } = check as Extract<MachineCheck, { id: 'git' }>
    if (version === null) return { text: text.gitMissing, effect: text.gitMissingEffect }
    return user ? { text: text.git(version), tip: text.gitUser } : { text: text.git(version), tip: text.gitNoUser, effect: text.gitNoUserEffect }
  }
  const { agent, version } = check as Extract<MachineCheck, { agent: string }>
  return check.ok ? { text: text.agent(agentName(agent), version) } : { text: text.agentMissing(agentName(agent)), effect: text.agentMissingEffect(agentName(agent)) }
}

/** What the joined machine runs, a captioned cell each: its system and Even Keel's version. */
export function JoinedAbout({ os, version }: { os: string; version: string }) {
  return (
    <>
      <span className="add-machine__cell">
        <span className="add-machine__caption">{t.machines.aboutOs}</span>
        {os}
      </span>
      <span className="add-machine__cell">
        <span className="add-machine__caption">{t.machines.aboutEvenKeel}</span>
        {version}
      </span>
    </>
  )
}

/** A project's steps in the connecting window are headed by its name with its key in brackets, or the key alone. */
export function projectGroup(state: EvenKeelState, project: string): string {
  const name = projectName(state, project)
  return name === null ? projectLabel(state, project) : `${name} (${projectLabel(state, project)})`
}

interface MachineJoinedProps {
  state: EvenKeelState
  machine: MachineView
  onClose: () => void
}

/**
 * The machine that joined: what it reported, the projects to connect it to (each with its folder there, free for a
 * clone or holding the project's clone, BTN-1298; connected by one job in `JobWindow`, BTN-1263) and
 * the hub's accounts to sign in to there. The sign-in itself runs in `MachineLoginDialog`, over this window.
 */
export function MachineJoined({ state, machine, onClose }: MachineJoinedProps) {
  const { send, sending, failure } = useCommand()
  const [chosen, setChosen] = useState<Set<string>>(() => new Set())
  const [picks, setPicks] = useState<Record<string, FolderPick>>({})
  const hubAgents = [...new Set(state.account.accounts.map((entry) => entry.agent))]
  const about = machine.about
  const root = about?.root ?? null
  const signIn = signInOf(machine, state.machineSignIns, hubAgents)
  const accounts = machineAccounts(state.account.accounts, signIn)
  const pickOf = (project: string): FolderPick => picks[project] ?? NEW_FOLDER
  const hubNameOf = (project: string): string => lastFolder(state.config.projects[project]?.repo ?? '')
  const unattached = state.projects.filter((project) => !machine.projects.includes(project))
  const folders = Object.fromEntries(unattached.map((project) => [project, machineFolder(pickOf(project), { root }, hubNameOf(project))]))
  const fresh = joinRequests(unattached, chosen, folders)
  // The folder decides between a clone and a clone already there (BTN-1298): each picked one is asked what it is.
  const probes = useFolderAnswers(fresh.flatMap((each) => (each.folder === undefined ? [] : [{ id: each.project, machine: machine.id, folder: each.folder, project: each.project }])))
  const blocked = fresh.some((each) => folderBlocked(pickOf(each.project), { root }, probes[each.project]))
  const busy = sending || machineLogin(state.machineSignIns) !== undefined
  const [token, setToken] = useState<MachineTokenTarget | null>(null)
  const job = state.jobs?.find((each) => each.kind === JOIN_KIND)

  const toggle = (project: string, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current)
      if (on) next.add(project)
      else next.delete(project)
      return next
    })
  const pick = (project: string, change: Partial<FolderPick>) => setPicks((current) => ({ ...current, [project]: { ...NEW_FOLDER, ...current[project], ...change } }))
  const connect = () => void send('machines/join', { machine: machine.id, projects: fresh })
  const finish = async () => {
    if (job !== undefined && (await send('job/close', { id: job.id }))) onClose()
  }

  return (
    <>
      <div className="add-package__body add-machine__appear">
        <p className={`add-machine__joined${machine.online ? '' : ' add-machine__joined--off'}`}>
          <span className="add-machine__lamp" aria-hidden="true" />
          <strong>{t.machines.joined(machine.name)}</strong>
          {about !== null && <JoinedAbout os={osLabel(about.os)} version={about.evenKeel} />}
          {!machine.online && <span className="add-machine__about">{t.machines.offline}</span>}
        </p>

        {about !== null && (
          <section className="add-machine__section">
            <SectionLabel>{t.machines.onMachine}</SectionLabel>
            <ul className="add-machine__list">
              {machineChecks(about, hubAgents).map((check) => {
                const { text, tip, effect } = checkText(check)
                return (
                  <li key={check.id} className="add-machine__row">
                    <span className={`add-machine__mark add-machine__mark--${check.ok ? 'ok' : 'warn'}`}>{check.ok ? <CheckIcon /> : <BangIcon />}</span>
                    <span className="add-machine__fact">
                      {text}
                      {tip !== undefined && <HelpTip text={tip} align="start" />}
                    </span>
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
                const on = attached || chosen.has(project)
                const key = state.projectKeys[project] ?? project
                return (
                  <li key={project}>
                    <label className="add-machine__row add-machine__row--pick">
                      <input type="checkbox" checked={on} disabled={attached || sending} onChange={(event) => toggle(project, event.target.checked)} />
                      <span className="add-machine__fact">
                        <span className="add-machine__key">{key}</span> <span className="add-machine__muted">{projectName(state, project)}</span>
                      </span>
                      {(attached || !on) && <span className="add-machine__effect">{attached ? t.machines.attached : t.machines.skip}</span>}
                    </label>
                    {on && !attached && (
                      <div className="machine-folder add-machine__place">
                        <MachineFolderField
                          labels={{ folder: t.machines.folderOf(key), path: t.machines.pathOf(key) }}
                          root={root}
                          pick={pickOf(project)}
                          hubName={hubNameOf(project)}
                          probe={probes[project]}
                          disabled={sending}
                          onChange={(change) => pick(project, change)}
                        />
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {fresh.length > 0 && (
            <>
              <p className="add-package__note">{t.machines.placeHint}</p>
              <p className="add-package__note">{t.machines.checks}</p>
            </>
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
                        <Tipped tip={t.account.machineOnTokenTip(machine.name)} align="end" inline focusable>
                          <span className="tag">{t.account.machineOnToken}</span>
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
        <button type="button" className="button button--primary" disabled={fresh.length === 0 || blocked || sending || job !== undefined} onClick={connect}>
          {t.machines.connect}
        </button>
      </footer>
      {token !== null && <MachineTokenDialog target={token} onClose={() => setToken(null)} />}
      {job !== undefined && (
        <JobWindow
          job={job}
          title={t.machines.window}
          stepLabel={(id) => {
            const { step } = stepOf(id)
            return t.creation.window.steps[step] ?? step
          }}
          groupOf={(id) => {
            const { project } = stepOf(id)
            return project === undefined ? undefined : projectGroup(state, project)
          }}
          done={{ label: t.pool.done, onDone: () => void finish() }}
          undoNote={t.machines.undoable}
        />
      )}
    </>
  )
}
