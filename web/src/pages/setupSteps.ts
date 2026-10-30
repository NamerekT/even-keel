import type { CliCopyView } from '../../../src/agent/cli-state.js'

/** The first run's setup (BTN-310): one page, the step in its address so that the browser's Back goes a step back. */
export const SETUP = '/setup'

/**
 * The steps in order. The stats go last of the settings: choosing them ends the first run (`firstRun`), and the
 * project wizard comes after them.
 */
export const SETUP_STEPS = ['language', 'agent', 'tracker', 'updates', 'stats'] as const
export type SetupStep = (typeof SETUP_STEPS)[number]

/** The step of the address; one it does not know is the first. */
export function setupStep(search: URLSearchParams): SetupStep {
  return SETUP_STEPS.find((step) => step === search.get('step')) ?? SETUP_STEPS[0]
}

export const stepPath = (step: SetupStep): string => `${SETUP}?step=${step}`

/** The stats step's second part: the connection of the user's own Postgres. */
export const STATS_SERVER = `${stepPath('stats')}&db=server`

/** The steps that can be left for later: the page says "Skip for now" on them. */
export const OPTIONAL_STEPS: readonly SetupStep[] = ['tracker', 'stats']

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

/** The step before and after; `null` — none, the first step or the last. */
export function stepBeside(step: SetupStep, by: -1 | 1): SetupStep | null {
  return SETUP_STEPS[SETUP_STEPS.indexOf(step) + by] ?? null
}
