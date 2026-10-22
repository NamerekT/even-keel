import type { StepFailure, UpdateMode, UpdateStep } from './model.js'

/** A step that failed with what its command printed. */
export class StepError extends Error {}

export interface StepPlan {
  mode: UpdateMode
  /** `null` — a rebuild whose `package-lock.json` did not change. */
  install: 'ci' | 'install' | null
}

/**
 * The order of the steps, the one place it is kept: `rebuild.ps1` and the page's button both run it. New code never
 * goes under a running service (tsx may load a module later from the new sources) and npm installs only with it stopped
 * (on Windows the running service holds esbuild's binary: EPERM). A rebuild finds the code already moved by the push:
 * without new dependencies it builds first, so the service is down only for the restart.
 */
export function stepsOf(plan: StepPlan): UpdateStep[] {
  if (plan.mode === 'rebuild') {
    return plan.install === null ? ['build', 'settle', 'stop', 'start', 'answer'] : ['settle', 'stop', 'install', 'build', 'start', 'answer']
  }
  return ['stop', ...(plan.mode === 'update' ? (['fetch'] as const) : []), 'checkout', 'install', 'build', 'start', 'answer']
}

/**
 * What undoes a failure at `failed`: before the checkout only the service is started again; from it on the commit that
 * ran before comes back with its dependencies and build. A rebuild has no commit to go back to: it only leaves the
 * service started.
 */
export function rollbackOf(mode: UpdateMode, failed: UpdateStep): UpdateStep[] {
  if (mode === 'rebuild') return failed === 'start' || failed === 'answer' ? [] : ['start']
  if (failed === 'stop' || failed === 'fetch' || failed === 'settle') return ['start', 'answer']
  return ['stop', 'restore', 'install', 'build', 'start', 'answer']
}

export interface StepsOutcome {
  failed: StepFailure | null
  rollback: { failed: StepFailure | null } | null
}

/** The step as it failed: a `StepError` carries the command's output, anything else its message. */
function failureOf(step: UpdateStep, error: unknown): StepFailure {
  return { step, output: error instanceof Error ? error.message : String(error) }
}

/**
 * Runs the steps; on the first failure runs its rollback, which goes on past a failed `stop` (the service may be down
 * already) and ends at any other failure.
 */
export async function runSteps(plan: StepPlan, act: (step: UpdateStep, rollback: boolean) => Promise<void>): Promise<StepsOutcome> {
  for (const step of stepsOf(plan)) {
    try {
      await act(step, false)
    } catch (error) {
      const failed = failureOf(step, error)
      const back = rollbackOf(plan.mode, step)
      return { failed, rollback: back.length === 0 ? null : { failed: await rollBack(back, act) } }
    }
  }
  return { failed: null, rollback: null }
}

async function rollBack(steps: UpdateStep[], act: (step: UpdateStep, rollback: boolean) => Promise<void>): Promise<StepFailure | null> {
  for (const step of steps) {
    try {
      await act(step, true)
    } catch (error) {
      if (step !== 'stop') return failureOf(step, error)
    }
  }
  return null
}
