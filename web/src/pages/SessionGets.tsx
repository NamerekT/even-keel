import { Fold } from '../ui/Fold.js'
import type { ReactNode } from 'react'
import { fallbackPassed, instructionsFor, skillFoldersFor, type InstructionFile } from '../../../src/agent/projectRules.js'
import type { PackagesView } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { useToolsViews, type Loaded } from '../tools/useToolsViews.js'
import { Loading } from '../ui/Loader.js'
import { HelpTip } from './settingsParts.js'
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
  plain,
}: {
  project: string
  agent: string
  prompts: { shared: boolean; project: boolean }
  packages: PackagesView | null
  trim: boolean
  /** The documents of the project's standards (BTN-359), as the form holds them. */
  standards: string[]
  /** A project without git: read from its folder, not a branch. */
  plain: boolean
}) {
  const loaded = useToolsViews([project], trim).get(project)
  return (
    <Loading busy={loaded === undefined || loaded.state === 'loading'} label={plain ? t.settings.gets.loadingPlain : t.settings.gets.loading}>
      {loaded !== undefined && loaded.state !== 'loading' && <Gets loaded={loaded} agent={agent} prompts={prompts} packages={packages} project={project} standards={standards} />}
    </Loading>
  )
}

function Gets({
  loaded,
  agent,
  prompts,
  packages,
  project,
  standards,
}: {
  loaded: Exclude<Loaded, { state: 'loading' }>
  agent: string
  prompts: { shared: boolean; project: boolean }
  packages: PackagesView | null
  project: string
  standards: string[]
}) {
  const rules = loaded.state === 'ready' ? (loaded.view?.rules ?? null) : null
  if (rules === null) return <p className="gets__state">{t.settings.gets.unknown}</p>
  const gets = sessionGets(agent, rules, prompts, packages, project)
  const text = t.settings.gets
  const presence = (on: boolean) => (on ? text.present : text.absent)
  const names = (list: string[], empty: string) => (list.length === 0 ? <span>{empty}</span> : <span className="gets__mono">{list.join(', ')}</span>)

  return (
    <div className="gets">
      {gets.none && <p className="notice notice--warn">{text.none}</p>}
      <dl className="gets__list">
        <Fact
          label={text.instructions}
          tips={[gets.passed && text.passed, gets.files.length > 1 && text.together, gets.unread.length > 0 && text.unread(gets.unread.join(', '))]}
        >
          {names(gets.files, text.noFile)}
        </Fact>
        <Fact label={text.sharedPrompt}>{presence(gets.prompts.shared)}</Fact>
        <Fact label={text.projectPrompt}>{presence(gets.prompts.project)}</Fact>
        <Fact label={text.skills} tips={gets.missed.map((each) => text.missed(each.names.join(', '), each.folder))}>
          {names(gets.skills, text.absent)}
        </Fact>
        <Fact label={text.packages} tips={[gets.packages.some((each) => !each.hooks) && text.noHooks]}>
          {names(
            gets.packages.map((each) => each.name),
            text.absent,
          )}
        </Fact>
        <Fact label={text.standards} tips={[standards.length > 0 && text.standardsHow]}>
          {names(standards, text.absent)}
        </Fact>
      </dl>
      <AllAgents />
    </div>
  )
}

/** A fact of what the session gets; what is worth knowing about it stands in the "?" of its own row. */
function Fact({ label, tips = [], children }: { label: string; tips?: (string | false)[]; children: ReactNode }) {
  const lines = tips.filter((each): each is string => each !== false)
  return (
    <div className="gets__fact">
      <dt>
        {label}
        {lines.length > 0 && <HelpTip text={lines.join('\n')} lines />}
      </dt>
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
