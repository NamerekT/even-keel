import { headerLevels, inheritedLevels } from '../../../src/account/header-levels.js'
import type { EvenKeelState, MachineSignIn, ProjectForm, SharedForm } from '../../../src/state.js'
import type { RunSettings } from '../../../src/sessions/launch.js'
import { fakeAccount, FAKE_LIMITS } from './fakeAccounts.js'
import { fakeMachineColors } from './fakeMachines.js'
import { ago, session } from './fakeSessions.js'

const FAKE_EMAIL = 'john.doe@example.com'

/** Read-only header fixtures exercise the server's selector too; the rendered page never chooses accounts. */
export function prepareHeaderLevels(state: EvenKeelState, mode: string | null): EvenKeelState {
  if (!mode) return state
  if (mode.startsWith('sessionAccounts')) {
    const account = fakeAccount('codex', false, FAKE_LIMITS)
    account.accounts = account.accounts
      .filter((entry) => mode !== 'sessionAccounts-missing' || entry.agent !== 'codex')
      .map((entry) => ({ ...entry, name: entry.key === 'global' ? 'Claude account' : entry.key === 'codex'
        ? mode === 'sessionAccounts-long' ? 'OpenAI account with a deliberately long display name for session history' : 'OpenAI account'
        : entry.name }))
    const sessions = state.sessions.map((session) => session.task !== 'ABC-5' ? session : {
      ...session, agent: 'codex', model: 'gpt-6.1-sol', account: mode === 'sessionAccounts-empty' ? null : 'john.doe@example.com',
    })
    return { ...state, account, sessions }
  }
  const account = fakeAccount('opencode', false, FAKE_LIMITS)
  const shared: SharedForm = { ...state.config.shared, accounts: { ...state.config.shared.accounts, opencode: 'opencode' }, provider: mode === 'three' || mode === 'long' || mode === 'tokens' ? 'codex' : 'claude' }
  account.active = shared.accounts[shared.provider]!
  const project: ProjectForm = { ...state.config.projects.ABC!, provider: mode === 'one' ? null : 'claude', accounts: mode === 'one' ? {} : { claude: 'jane.roe' } }
  account.accounts = account.accounts.map((entry) => entry.key === 'jane.roe' ? { ...entry, usage: { state: 'ok', reason: null, since: FAKE_LIMITS.updatedAt }, limits: { ...FAKE_LIMITS, fiveHour: { ...FAKE_LIMITS.fiveHour!, usedPercentage: 9 }, sevenDay: { ...FAKE_LIMITS.sevenDay!, usedPercentage: 21 } } } : entry)
  const runs = { ...state.runs, ABC: { 'ABC-6': { provider: 'opencode', model: null, effort: null } } }
  const sessions = state.sessions.map((session) => session.task !== 'ABC-5' ? session : { ...session, agent: mode === 'tokens' ? 'opencode' : 'claude', account: mode === 'tokens' ? 'opencode' : mode === 'two' || mode === 'stale' ? 'jane.roe' : 'global' })
  if (mode === 'long') account.accounts = account.accounts.map((entry) => ({ ...entry, name: 'Example account with a forty letter name', status: entry.status && { ...entry.status, email: `${entry.key}@example.com` } }))
  if (mode === 'stale') account.accounts = account.accounts.map((entry) => entry.key === 'jane.roe' ? { ...entry, usage: { ...entry.usage, state: 'stale' }, limits: entry.limits && { ...entry.limits, updatedAt: new Date(Date.now() - 36 * 60_000).toISOString() } } : entry)
  return { ...state, account, runs, sessions, config: { ...state.config, shared, projects: { ...state.config.projects, ABC: project } } }
}

/**
 * `?chain=accounts|accountsOut` (BTN-1805): ABC's two lanes on two machines and two accounts — ABC-5 on the workstation
 * as the global account, ABC-6 on the home server as jane.roe; `accountsOut` also signs the global account out there.
 */
export function withDivergedAccounts(state: EvenKeelState, mode: string | null): EvenKeelState {
  if (mode !== 'accounts' && mode !== 'accountsOut') return state
  const active = state.chain.active.find((lane) => lane.project === 'ABC')
  if (active?.current == null) return state
  const machineNames = { pc: 'Workstation', srv: 'Home server' }
  const since = ago(1.5)
  const first = state.sessions.find((each) => each.task === active.current!.task)
  const second = { ...session('ABC-6', 41_000, 'working'), startedAt: since, account: 'jane.roe@example.com' }
  const sessions = [...state.sessions.filter((each) => each.task !== 'ABC-6').map((each) => each === first ? { ...each, account: FAKE_EMAIL } : each), second]
  const lanes = [{ ...active, machine: 'pc' }, { project: 'ABC', machine: 'srv', current: { task: 'ABC-6', sessionId: second.sessionId, since }, paused: false, error: null }]
  const out: MachineSignIn = { machine: 'srv', name: machineNames.srv, online: true, login: null, missing: [],
    accounts: [{ key: 'global', agent: 'claude', email: FAKE_EMAIL, signedIn: false }, { key: 'jane.roe', agent: 'claude', email: 'jane.roe@example.com', signedIn: true }] }
  return {
    ...state, ...fakeMachineColors(machineNames), machineNames, sessions,
    chain: { ...state.chain, active: [...lanes, ...state.chain.active.filter((lane) => lane !== active)] },
    taskSessions: { ...state.taskSessions, 'ABC-6': [{ sessionId: second.sessionId, at: since, how: 'launch', resumed: 0, answers: 0, machine: 'srv' }] },
    ...(mode === 'accountsOut' && { machineSignIns: [out] }),
  }
}

export function withHeaderLevels(state: EvenKeelState): EvenKeelState {
  const shared = state.config.shared
  const sharedRun: RunSettings = { provider: shared.provider, accounts: shared.accounts, models: shared.models }
  const hasAccount = (provider: string, key: string) => state.account.accounts.some((entry) => entry.key === key && entry.agent === provider)
  const projectRun = (project: string): RunSettings => {
    const own = state.config.projects[project]
    return { provider: own?.provider ?? shared.provider, accounts: { ...shared.accounts, ...own?.accounts }, models: { ...shared.models, ...own?.models } }
  }
  const inherited = Object.fromEntries(state.projects.map((project) => [project, inheritedLevels({ shared: sharedRun, project: projectRun(project), hasAccount })]))
  const levels = Object.fromEntries(state.projects.map((project) => {
    return [project, headerLevels({
      shared: sharedRun,
      project: projectRun(project),
      runOf: (task) => state.runs[project]?.[task],
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
  return { ...state, account: { ...state.account, headerLevels: levels, inheritedLevels: inherited } }
}
