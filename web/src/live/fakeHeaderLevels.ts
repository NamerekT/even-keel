import { headerLevels } from '../../../src/account/header-levels.js'
import type { EvenKeelState, ProjectForm, SharedForm } from '../../../src/state.js'
import type { RunSettings } from '../../../src/sessions/launch.js'
import { fakeAccount, FAKE_LIMITS } from './fakeAccounts.js'

/** Read-only header fixtures exercise the server's selector too; the rendered page never chooses accounts. */
export function prepareHeaderLevels(state: EvenKeelState, mode: string | null): EvenKeelState {
  if (!mode) return state
  const account = fakeAccount('opencode', false, FAKE_LIMITS)
  const shared: SharedForm = { ...state.config.shared, accounts: { ...state.config.shared.accounts, opencode: 'opencode' }, modelLabels: true, provider: mode === 'three' || mode === 'long' || mode === 'tokens' ? 'codex' : 'claude' }
  account.active = shared.accounts[shared.provider]!
  const project: ProjectForm = { ...state.config.projects.ABC!, provider: mode === 'one' ? null : 'claude', accounts: mode === 'one' ? {} : { claude: 'jane.roe' } }
  account.accounts = account.accounts.map((entry) => entry.key === 'jane.roe' ? { ...entry, usage: { state: 'ok', reason: null, since: FAKE_LIMITS.updatedAt }, limits: { ...FAKE_LIMITS, fiveHour: { ...FAKE_LIMITS.fiveHour!, usedPercentage: 9 }, sevenDay: { ...FAKE_LIMITS.sevenDay!, usedPercentage: 21 } } } : entry)
  const tasks = state.tasks.map((task) => task.project !== 'ABC' ? task : { ...task, runLabels: task.id === 'ABC-6' ? [{ provider: 'opencode', model: null }] : [] })
  const sessions = state.sessions.map((session) => session.task !== 'ABC-5' ? session : { ...session, agent: mode === 'tokens' ? 'opencode' : 'claude', account: mode === 'tokens' ? 'opencode' : mode === 'two' || mode === 'stale' ? 'jane.roe' : 'global' })
  if (mode === 'long') account.accounts = account.accounts.map((entry) => ({ ...entry, name: 'Example account with a forty letter name', status: entry.status && { ...entry.status, email: `${entry.key}@example.com` } }))
  if (mode === 'stale') account.accounts = account.accounts.map((entry) => entry.key === 'jane.roe' ? { ...entry, usage: { ...entry.usage, state: 'stale' }, limits: entry.limits && { ...entry.limits, updatedAt: new Date(Date.now() - 36 * 60_000).toISOString() } } : entry)
  return { ...state, account, tasks, sessions, config: { ...state.config, shared, projects: { ...state.config.projects, ABC: project } } }
}

export function withHeaderLevels(state: EvenKeelState): EvenKeelState {
  const shared = state.config.shared
  const sharedRun: RunSettings = { provider: shared.provider, accounts: shared.accounts, models: shared.models, labels: shared.modelLabels }
  const hasAccount = (provider: string, key: string) => state.account.accounts.some((entry) => entry.key === key && entry.agent === provider)
  const levels = Object.fromEntries(state.projects.map((project) => {
    const own = state.config.projects[project]
    return [project, headerLevels({
      shared: sharedRun,
      project: { provider: own?.provider ?? shared.provider, accounts: { ...shared.accounts, ...own?.accounts }, models: { ...shared.models, ...own?.models }, labels: own?.modelLabels ?? shared.modelLabels },
      tasks: state.tasks.filter((task) => task.project === project),
      order: state.chain.projects[project]?.order ?? [],
      current: state.chain.active.find((chain) => chain.project === project)?.current ?? null,
      holding: [...(state.chain.skipped[project] ?? []), ...(state.chain.projects[project]?.waiting ?? [])],
      sessionAccount: (id) => {
        const session = state.sessions.find((each) => each.sessionId === id)
        return state.account.accounts.find((entry) => entry.agent === session?.agent && (entry.key === session?.account || entry.status?.email === session?.account))?.key
      },
      hasAccount,
    })]
  }))
  return { ...state, account: { ...state.account, headerLevels: levels } }
}
