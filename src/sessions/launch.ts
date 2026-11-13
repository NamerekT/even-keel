import { modelOf } from '../agent/model-slots.js'
import { modelPromptMatches } from './model-prompts.js'
import { effortFor, type TaskRun } from './runs.js'

/** The provider of OpenCode an account folder is signed in to (`vendorOf` of `model-slots.ts`); `null` — not known or not OpenCode. */
export type VendorOf = (provider: string, account: string) => string | null

/** What a project's sessions run on, the shared values filled in under its own (`runSettings`). */
export interface RunSettings {
  provider: string
  /** The model by its slot (`MODEL_SLOTS`): a provider, an OpenCode provider; one without runs on its CLI's default. */
  models: Record<string, string>
  /** The account folder by provider: one per provider, no rotation on a spent limit. */
  accounts: Record<string, string>
}

export interface RunChoice {
  provider: string
  account: string
  /** `null` — the CLI's own default. */
  model: string | null
  /** The task's effort, where the provider it runs on takes that level; `null` — none is passed. */
  effort: string | null
  /** The provider of the task's run the pool has no account for; the session runs on the project's instead. */
  fallback: string | null
}

export interface LaunchPlan extends RunChoice {
  prompt: string
}

/**
 * What a new session of the task runs on: the provider of its run (`TaskRuns`), else the project's; the model by the
 * run, the project's then the shared one; the effort of the run. A run of a provider the pool has no account for does
 * not pause the chain: the task runs on the project's provider with the project's model. A handover keeps the choice —
 * it is the task's and the project's, not the previous session's. An OpenCode model of the config is the one of the
 * provider its account is signed in to (`vendorOf`, BTN-984).
 */
export function runChoice(
  run: TaskRun | undefined,
  settings: RunSettings,
  hasAccount: (provider: string, account: string) => boolean,
  vendorOf: VendorOf = () => null,
): RunChoice {
  const own = (provider: string, model: string | null = null, fallback: string | null = null): RunChoice => {
    const account = settings.accounts[provider]!
    return { provider, account, model: model ?? modelOf(settings.models, provider, vendorOf(provider, account)) ?? null, effort: effortFor(run, provider), fallback }
  }
  const provider = run?.provider ?? null
  if (run === undefined || provider === null) return own(settings.provider)
  const account = settings.accounts[provider]
  if (account === undefined || !hasAccount(provider, account)) return own(settings.provider, null, provider)
  return own(provider, run.model)
}

export function launchPlan(
  run: TaskRun | undefined,
  prompt: string,
  settings: RunSettings,
  prompts: Record<string, string>,
  hasAccount: (provider: string, account: string) => boolean,
  vendorOf: VendorOf = () => null,
): LaunchPlan {
  const choice = runChoice(run, settings, hasAccount, vendorOf)
  const extra = Object.entries(prompts).filter(([pattern]) => modelPromptMatches(pattern, choice.provider, choice.model)).map(([, text]) => text)
  return { ...choice, prompt: [prompt, ...extra].join('\n\n') }
}
