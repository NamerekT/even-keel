import type { CliCopyView } from '../../../src/agent/cli-state.js'
import type { Language } from '../../../src/language.js'
import type { PassableStep } from '../../../src/setup.js'
import type { GitSetupView } from '../../../src/state.js'
import type { TallyMode } from '../../../src/stats/mode.js'

/** The first run's setup (BTN-310): one page, the step in its address so that the browser's Back goes a step back. */
export const SETUP = '/setup'

/**
 * The steps in order. Git goes before the agent: nothing works without it (BTN-731). The stats go last of the settings:
 * choosing them ends the first run (`firstRun`), and the project wizard comes after them.
 */
export const SETUP_STEPS = ['language', 'git', 'agent', 'tracker', 'updates', 'stats'] as const
export type SetupStep = (typeof SETUP_STEPS)[number]

/** The step of the address; one it does not know is the first. */
export function setupStep(search: URLSearchParams): SetupStep {
  return SETUP_STEPS.find((step) => step === search.get('step')) ?? SETUP_STEPS[0]
}

export const stepPath = (step: SetupStep): string => `${SETUP}?step=${step}`

/** The stats step's second part: the connection of the user's own Postgres. */
export const STATS_SERVER = `${stepPath('stats')}&db=server`

/**
 * The steps that can be left for later: the page says "Skip for now" on them. Git is one while it is not ready: git can
 * be installed later.
 */
export const OPTIONAL_STEPS: readonly SetupStep[] = ['git', 'tracker', 'stats']

/** A profile's name inside its tracker's card: "Huly · example" is "example" there; a name of its own stays whole. */
export function profileShortName(name: string, tracker: string): string {
  const prefix = `${tracker} · `
  return name.startsWith(prefix) && name.length > prefix.length ? name.slice(prefix.length) : name
}

/** An account's name in the few words under a done step: an e-mail without its domain. */
export function accountShortName(name: string): string {
  const at = name.indexOf('@')
  return at > 0 ? name.slice(0, at) : name
}

/**
 * "Next" on the agent step (BTN-603): the chosen agent has something to run — its installed CLI or Even Keel's copy,
 * even one still downloading — and an account. Without copies in the state the accounts' `missing` tells the CLI.
 */
export function agentReady(provider: string, copy: CliCopyView | undefined, account: AccountPool, key: string): boolean {
  return cliRunnable(provider, copy, account.missing) && account.accounts.some((each) => each.key === key && each.agent === provider)
}

/** The agent has a CLI to run: its installed one, or Even Keel's copy downloaded or on its way. */
export function cliRunnable(provider: string, copy: CliCopyView | undefined, missing: readonly string[]): boolean {
  if (copy === undefined) return !missing.includes(provider)
  return copy.source === 'checked' ? copy.status === 'ready' || copy.status === 'downloading' : copy.system
}

interface AccountPool {
  missing: readonly string[]
  accounts: readonly { key: string; agent: string }[]
}

/** "Next" on the Git step: git starts from the service and has a name and an e-mail to commit with. */
export function gitReady(git: GitSetupView | undefined): boolean {
  return git !== undefined && git.version !== null && git.name !== null && git.email !== null
}

/**
 * The Git step's answer to "Use git?" as shown (BTN-886): the `defaultGit` setting once given, before that "Yes" where git
 * starts and nothing where it does not.
 */
export function gitChoice(defaultGit: boolean | null, git: GitSetupView | undefined): boolean | null {
  if (defaultGit !== null) return defaultGit
  return git !== undefined && git.version !== null ? true : null
}

/**
 * Whether going on from the Git step writes the "Yes" shown in advance (BTN-886): only "Next" keeps it. A pick has
 * already written its answer, and the page's settings may not show it yet: a first "No" must not turn into "Yes" (BTN-1034).
 */
export function gitYesToKeep(defaultGit: boolean | null, git: GitSetupView | undefined, picked: boolean): boolean {
  return !picked && defaultGit === null && gitChoice(null, git) === true
}

/** "Next" on the Git step: "No" goes on at once, "Yes" once git is ready (`gitReady`). */
export function gitStepReady(defaultGit: boolean | null, git: GitSetupView | undefined): boolean {
  const choice = gitChoice(defaultGit, git)
  return choice === false || (choice === true && gitReady(git))
}

/**
 * The git download page for the service's platform, shown under the install command or alone when the service found
 * no package manager (EKR-54). Even Keel itself installs no global CLI.
 */
export function gitDownload(platform: string): string {
  if (platform === 'win32') return 'https://git-scm.com/download/win'
  if (platform === 'darwin') return 'https://git-scm.com/download/mac'
  return 'https://git-scm.com/download/linux'
}

/** What tells whether each step of the setup has its answer (BTN-1023). */
export interface SetupFacts {
  language: Language | null
  defaultGit: boolean | null
  git: GitSetupView | undefined
  /** `agentReady` of the shared agent and its account. */
  agentReady: boolean
  profiles: number
  tally: TallyMode | null
  /** `setupPassed`: the steps gone past with no setting of their own. */
  passed: readonly PassableStep[]
}

/**
 * Whether a step has its answer, the one fact behind both the line's checks and where the setup stopped (BTN-1023): its
 * setting, or a skip kept in `setupPassed`. Git is answered by No or by a Yes with git ready, never by the Yes shown in
 * advance; the agent only by an account it can run on; the update check, on by default, only once gone past.
 */
export function stepAnswered(step: SetupStep, facts: SetupFacts): boolean {
  const passed = (facts.passed as readonly SetupStep[]).includes(step)
  if (step === 'language') return facts.language !== null
  if (step === 'git') return passed || (facts.defaultGit !== null && gitStepReady(facts.defaultGit, facts.git))
  if (step === 'agent') return facts.agentReady
  if (step === 'tracker') return passed || facts.profiles > 0
  if (step === 'updates') return passed
  return passed || facts.tally !== null
}

/** Where the setup stopped: its first step without an answer; `null` — every step has one, the project wizard is next. */
export function setupStop(facts: SetupFacts): SetupStep | null {
  return SETUP_STEPS.find((step) => !stepAnswered(step, facts)) ?? null
}

/** The step before and after; `null` — none, the first step or the last. */
export function stepBeside(step: SetupStep, by: -1 | 1): SetupStep | null {
  return SETUP_STEPS[SETUP_STEPS.indexOf(step) + by] ?? null
}
