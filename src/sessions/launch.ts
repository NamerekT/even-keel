import { runLabelText, type RunLabel, type Task } from '../tracker/model.js'

/** What a project's sessions run on, the shared values filled in under its own (`runSettings`). */
export interface RunSettings {
  provider: string
  /** The model by provider; a provider without one runs on its CLI's default. */
  models: Record<string, string>
  /** The account folder by provider: one per provider, no rotation on a spent limit. */
  accounts: Record<string, string>
  /** Whether the tasks' run labels are read. */
  labels: boolean
}

export interface RunChoice {
  provider: string
  account: string
  /** `null` — the CLI's own default. */
  model: string | null
  /** The provider of the task's label the pool has no account for; the session runs on the project's instead. */
  fallback: string | null
  warning: string | null
}

export interface LaunchPlan extends RunChoice {
  prompt: string
}

type Labelled = Pick<Task, 'id' | 'runLabels'>

/**
 * What a new session of the task runs on: its run label while labels are on, else the project's provider; the model
 * by the label, the project's then the shared one. A label of a provider the pool has no account for does not pause
 * the chain: the task runs on the project's provider with the project's model. A handover keeps the choice — it is
 * the task's and the project's, not the previous session's.
 */
export function runChoice(task: Labelled | undefined, run: RunSettings, hasAccount: (provider: string, account: string) => boolean): RunChoice {
  const own = (provider: string, model: string | null = null, fallback: string | null = null, warning: string | null = null): RunChoice => ({
    provider,
    account: run.accounts[provider]!,
    model: model ?? run.models[provider] ?? null,
    fallback,
    warning,
  })
  const labels = run.labels ? (task?.runLabels ?? []) : []
  if (labels.length > 1) return own(run.provider, null, null, `chain: ${task!.id} carries run labels ${labels.map(runLabelText).join(', ')}; launching it as its project says`)
  const label: RunLabel | undefined = labels[0]
  if (label === undefined) return own(run.provider)
  const account = run.accounts[label.provider]
  if (account === undefined || !hasAccount(label.provider, account)) return own(run.provider, null, label.provider)
  return own(label.provider, label.model)
}

// The prompt of a model is looked up by its name as the CLI gets it; a model left to the CLI has none.
export function launchPlan(
  task: Labelled | undefined,
  prompt: string,
  run: RunSettings,
  prompts: Record<string, string>,
  hasAccount: (provider: string, account: string) => boolean,
): LaunchPlan {
  const choice = runChoice(task, run, hasAccount)
  const name = choice.model?.toLowerCase()
  const extra = name === undefined ? undefined : Object.entries(prompts).find(([model]) => model.toLowerCase() === name)?.[1]
  return { ...choice, prompt: extra === undefined ? prompt : `${prompt}\n\n${extra}` }
}
