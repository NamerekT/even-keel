import type { EvenKeelState } from '../../../src/state.js'
import type { RemoteProtection } from '../../../src/ci/protection-model.js'
import { protectionRules } from '../../../src/sessions/protection.js'
import { protectionMessages } from '../i18n/protection.js'
import { kindShown, noticeId, notDismissed, NoticeButtons } from '../layout/NoticeButtons.js'
import { Band } from '../ui/blocks.js'
import { FoldList } from '../ui/Fold.js'
import { projectPath } from '../state.js'
import { openTab, projectScope } from './settingsStore.js'

export function protectionAgents(state: EvenKeelState, project: string): string[] {
  const form = state.config.projects[project]
  const tasks = new Set(state.tasks.filter(task => task.project === project).map(task => task.id))
  return [...new Set([form?.provider ?? state.config.shared.provider, ...state.sessions.filter(session => tasks.has(session.task)).map(session => session.agent)])].filter(agent => {
    if (agent !== 'codex' && agent !== 'copilot' && agent !== 'claude' && agent !== 'opencode') return false
    if (agent === 'codex' && state.config.shared.execution.codex !== 'bypass') return false
    const rules = protectionRules(form?.protection ?? state.config.shared.protection)
    return agent === 'opencode' ? rules.opencode.bash.length + rules.opencode.tools.length === 0 : rules[agent].length === 0
  })
}

export const remoteProtectionWarnings = (state: EvenKeelState, project: string) => (state.protection?.[project] ?? []).filter(item => item.status !== 'protected' || item.bypass)

/** The two protection bands of a project as they stand after "Got it" and "Don't show again" (BTN-759). */
function protectionBands(state: EvenKeelState, project: string) {
  const agents = protectionAgents(state, project)
  const agentsStamp = agents.join(',')
  const agentsMark = noticeId('protection.noRules', project)
  const remotes = remoteProtectionWarnings(state, project)
  const remotesStamp = JSON.stringify(remotes.map(({ remote, branch, status, bypass }) => [remote, branch, status, bypass]))
  const remotesMark = noticeId('protection.remote', project)
  return {
    agents: agents.length > 0 && kindShown(state, 'protection.noRules', project) && notDismissed(state, agentsMark, agentsStamp) ? { agents, stamps: { [agentsMark]: agentsStamp } } : null,
    remotes: remotes.length > 0 && kindShown(state, 'protection.remote', project) && notDismissed(state, remotesMark, remotesStamp) ? { remotes, stamps: { [remotesMark]: remotesStamp } } : null,
  }
}

export function protectionShown(state: EvenKeelState, project: string): boolean {
  const bands = protectionBands(state, project)
  return bands.agents !== null || bands.remotes !== null
}

const AGENT_NAMES: Record<string, string> = { codex: 'Codex', copilot: 'Copilot', claude: 'Claude Code', opencode: 'OpenCode' }

/**
 * An agent without the rules that guard the main branch, and a remote whose main branch the server does not protect:
 * one band each per project, the agents or the remotes listed in it, each remote with its own link (BTN-759).
 */
export function ProtectionWarnings({ state, project }: { state: EvenKeelState; project: string }) {
  const text = protectionMessages()
  const { agents, remotes } = protectionBands(state, project)
  return <FoldList items={[
    ...(agents === null ? [] : [{ key: 'agents', children: <Band tone="warn" action={<>
      <a className="button button--small" href={`${projectPath(project)}#settings`} onClick={() => openTab(projectScope(project), 'sessions')}>{text.title}</a>
      <NoticeButtons stamps={agents.stamps} kind="protection.noRules" project={project} small />
    </>}>
      {agents.agents.map(agent => AGENT_NAMES[agent] ?? agent).join(', ')}: {text.noRules}
    </Band> }]),
    ...(remotes === null ? [] : [{ key: 'remotes', children: <Band tone="warn" action={<NoticeButtons stamps={remotes.stamps} kind="protection.remote" project={project} small />}>
      <ul className="protection__remotes">
        {remoteGroups(remotes.remotes).map(group => <RemoteLine key={`${group.branch} ${group.status}`} group={group} />)}
      </ul>
    </Band> }]),
  ]} />
}

/** Remotes with the same branch and verdict share one sentence; each keeps its own link. */
type RemoteGroup = Pick<RemoteProtection, 'branch' | 'status'> & { items: RemoteProtection[] }

function remoteGroups(remotes: RemoteProtection[]): RemoteGroup[] {
  const groups = new Map<string, RemoteGroup>()
  for (const item of remotes) {
    const key = `${item.branch}\u0000${item.status}`
    const group = groups.get(key) ?? { branch: item.branch, status: item.status, items: [] }
    group.items.push(item)
    groups.set(key, group)
  }
  return [...groups.values()]
}

function RemoteLine({ group: { branch, status, items } }: { group: RemoteGroup }) {
  const text = protectionMessages()
  return (
    <li className="protection__remote">
      <span>{branch}: {status === 'unknown' ? text.unknown : status === 'unprotected' ? text.unprotected : text.partial}</span>
      <span className="protection__links">
        {items.map(item => <a key={item.remote} className="button button--small" href={item.url} target="_blank" rel="noreferrer">{text.settings}: {item.remote}</a>)}
      </span>
    </li>
  )
}
