import { Fold } from '../ui/Fold.js'
import type { ReactNode } from 'react'
import { fallbackPassed, instructionsFor, skillFoldersFor, type InstructionFile } from '../../../src/agent/projectRules.js'
import type { PackagesView } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { useToolsViews } from '../tools/useToolsViews.js'
import { sessionGets } from './sessionRules.js'
import { providerName } from './settingsRun.js'
import './sessionRules.css'

const AGENTS = ['claude', 'codex', 'opencode', 'copilot']

/** "What the session gets" on the project's settings: for the agent the form names, read from the project's branch (BTN-340). */
export function SessionGets({
  project,
  agent,
  prompts,
  packages,
  trim,
  standards,
}: {
  project: string
  agent: string
  prompts: { shared: boolean; project: boolean }
  packages: PackagesView | null
  trim: boolean
  /** The documents of the project's standards (BTN-359), as the form holds them. */
  standards: string[]
}) {
  const loaded = useToolsViews([project], trim).get(project)
  if (loaded === undefined || loaded.state === 'loading') return <p className="settings__hint">{t.settings.gets.loading}</p>
  const rules = loaded.state === 'ready' ? (loaded.view?.rules ?? null) : null
  if (rules === null) return <p className="settings__hint">{t.settings.gets.unknown}</p>
  const gets = sessionGets(agent, rules, prompts, packages, project)
  const text = t.settings.gets
  const presence = (on: boolean) => (on ? text.present : text.absent)
  const names = (list: string[], empty: string) => (list.length === 0 ? <span>{empty}</span> : <span className="gets__mono">{list.join(', ')}</span>)

  return (
    <div className="gets">
      {gets.none && <p className="notice notice--warn">{text.none}</p>}
      <dl className="gets__list">
        <Fact label={text.instructions}>
          {names(gets.files, text.noFile)}
          {gets.passed && <span className="gets__note">{text.passed}</span>}
          {gets.files.length > 1 && <span className="gets__note">{text.together}</span>}
          {gets.unread.length > 0 && <span className="gets__note">{text.unread(gets.unread.join(', '))}</span>}
        </Fact>
        <Fact label={text.sharedPrompt}>{presence(gets.prompts.shared)}</Fact>
        <Fact label={text.projectPrompt}>{presence(gets.prompts.project)}</Fact>
        <Fact label={text.skills}>
          {names(gets.skills, text.absent)}
          {gets.missed.map((each) => (
            <span key={each.folder} className="gets__note">
              {text.missed(each.names.join(', '), each.folder)}
            </span>
          ))}
        </Fact>
        <Fact label={text.packages}>
          {names(
            gets.packages.map((each) => each.name),
            text.absent,
          )}
          {gets.packages.some((each) => !each.hooks) && <span className="gets__note">{text.noHooks}</span>}
        </Fact>
        <Fact label={text.standards}>
          {names(standards, text.absent)}
          {standards.length > 0 && <span className="gets__note">{text.standardsHow}</span>}
        </Fact>
      </dl>
      <AllAgents />
    </div>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="gets__fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/** The same rules for every agent, as the guide's table has them. */
function AllAgents() {
  const text = t.settings.gets
  const cell = (agent: string, files: InstructionFile[]) => {
    const read = instructionsFor(agent, files)
    const shown = read.join(', ')
    return fallbackPassed(agent, read) ? text.byEvenKeel(shown) : shown
  }
  return (
    <Fold className="gets__all" summary={<>{text.table}</>}>
      {() => (
        <>
          <div className="gets__scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">{text.head.agent}</th>
                  <th scope="col">{text.head.claudeOnly}</th>
                  <th scope="col">{text.head.agentsOnly}</th>
                  <th scope="col">{text.head.both}</th>
                  <th scope="col">{text.head.skills}</th>
                </tr>
              </thead>
              <tbody>
                {AGENTS.map((agent) => (
                  <tr key={agent}>
                    <th scope="row">{providerName(agent)}</th>
                    <td>{cell(agent, ['CLAUDE.md'])}</td>
                    <td>{cell(agent, ['AGENTS.md'])}</td>
                    <td>{cell(agent, ['CLAUDE.md', 'AGENTS.md'])}</td>
                    <td>{skillFoldersFor(agent).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Fold>
  )
}
