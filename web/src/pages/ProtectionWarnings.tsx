import type { EvenKeelState } from '../../../src/state.js'
import { protectionRules } from '../../../src/sessions/protection.js'
import { protectionMessages } from '../i18n/protection.js'
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

export function ProtectionWarnings({ state, project }: { state: EvenKeelState; project: string }) {
  const text = protectionMessages()
  return <FoldList items={[
    ...protectionAgents(state, project).map(agent => ({ key: `agent-${agent}`, children: <Band tone="warn" action={<a className="button button--small" href={`${projectPath(project)}#settings`} onClick={() => openTab(projectScope(project), 'sessions')}>{text.title}</a>}>
      {agent === 'codex' ? 'Codex' : agent === 'copilot' ? 'Copilot' : agent === 'claude' ? 'Claude Code' : 'OpenCode'}: {text.noRules}
    </Band> })),
    ...remoteProtectionWarnings(state, project).map(item => ({ key: `remote-${item.remote}`, children: <Band tone="warn" action={<a className="button button--small" href={item.url} target="_blank" rel="noreferrer">{text.settings}</a>}>
      {item.remote} · {item.branch}: {item.status === 'unknown' ? text.unknown : item.status === 'unprotected' ? text.unprotected : text.partial}
    </Band> })),
  ]} />
}
