import type { EvenKeelState } from '../../../src/state.js'
import { protectionRules } from '../../../src/sessions/protection.js'
import { protectionMessages } from '../i18n/protection.js'
import { Band } from '../ui/blocks.js'
import { projectPath } from '../state.js'
import { openTab, projectScope } from './settingsStore.js'

export function protectionAgents(state: EvenKeelState, project: string): string[] {
  const form = state.config.projects[project]
  const tasks = new Set(state.tasks.filter(task => task.project === project).map(task => task.id))
  return [...new Set([form?.provider ?? state.config.shared.provider, ...state.sessions.filter(session => tasks.has(session.task)).map(session => session.agent)])].filter(agent => {
    if (agent === 'opencode') return true
    if (agent !== 'codex' && agent !== 'copilot' && agent !== 'claude') return false
    if (agent === 'codex' && state.config.shared.execution.codex !== 'bypass') return false
    const rules = protectionRules(form?.protection ?? state.config.shared.protection)
    return rules[agent].length === 0
  })
}

export const remoteProtectionWarnings = (state: EvenKeelState, project: string) => (state.protection?.[project] ?? []).filter(item => item.status !== 'protected' || item.bypass)

export function ProtectionWarnings({ state, project }: { state: EvenKeelState; project: string }) {
  const text = protectionMessages()
  return <>
    {protectionAgents(state, project).map(agent => <Band key={agent} tone="warn" action={<a className="button button--small" href={`${projectPath(project)}#settings`} onClick={() => openTab(projectScope(project), 'sessions')}>{text.title}</a>}>
      {agent === 'codex' ? 'Codex' : agent === 'copilot' ? 'Copilot' : agent === 'claude' ? 'Claude Code' : 'OpenCode'}: {agent === 'opencode' ? text.unsupported : text.noRules}
    </Band>)}
    {remoteProtectionWarnings(state, project).map(item => <Band key={item.remote} tone="warn" action={<a className="button button--small" href={item.url} target="_blank" rel="noreferrer">{text.settings}</a>}>
      {item.remote} · {item.branch}: {item.status === 'unknown' ? text.unknown : item.status === 'unprotected' ? text.unprotected : text.partial}
    </Band>)}
  </>
}
