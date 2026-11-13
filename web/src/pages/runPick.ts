import { EFFORTS } from '../../../src/agent/providers.js'
import { sameRun, type TaskRun } from '../../../src/sessions/runs.js'

/** The task card's choice of what its sessions run on; `''` in a field is "as the project says", for the effort — none passed. */
export interface RunPick {
  provider: string
  model: string
  effort: string
}

/** What the card's fields show for the task's run. */
export function runPickOf(run: TaskRun | null | undefined): RunPick {
  return { provider: run?.provider ?? '', model: run?.model ?? '', effort: run?.effort ?? '' }
}

/** The efforts the pick offers: those of the picked provider, else of the one the project runs on; none where it takes no effort. */
export function effortsOf(provider: string, projectProvider: string): readonly string[] {
  return EFFORTS[provider === '' ? projectProvider : provider] ?? []
}

/**
 * The pick after another provider is chosen: the model goes with its provider and the one typed for the new provider
 * before comes back (`models`, BTN-984); the effort stays where the new one takes it.
 */
export function withProvider(pick: RunPick, provider: string, projectProvider: string, models: Readonly<Record<string, string>> = {}): RunPick {
  if (provider === pick.provider) return pick
  return { provider, model: models[provider] ?? '', effort: effortsOf(provider, projectProvider).includes(pick.effort) ? pick.effort : '' }
}

/** The models typed on the card by provider, with the pick's own: what `withProvider` brings back. */
export function rememberModel(models: Readonly<Record<string, string>>, pick: RunPick): Record<string, string> {
  return pick.provider === '' || models[pick.provider] === pick.model ? models : { ...models, [pick.provider]: pick.model }
}

/** The run the pick asks for, as the `task/run` command takes it; `null` — the task has it already. */
export function runPickChange(run: TaskRun | null | undefined, pick: RunPick): TaskRun | null {
  const model = pick.model.trim()
  const asked: TaskRun = {
    provider: pick.provider === '' ? null : pick.provider,
    model: pick.provider === '' || model === '' ? null : model,
    effort: pick.effort === '' ? null : pick.effort,
  }
  return sameRun(run, asked) ? null : asked
}
