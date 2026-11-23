/**
 * A slow CI runner (macOS, docs/ci.md "macOS"): `E2E_SLOW_RUNNER=<factor>` multiplies every e2e timeout by the factor
 * and runs once more a test that failed on a timeout of its own or of a hook; any other failure is not retried. Unset,
 * the factor is 1 and nothing is retried: Linux, Windows and a workstation run as before.
 */
export const SLOW_RUNNER_ENV = 'E2E_SLOW_RUNNER'

/** The factor of `E2E_SLOW_RUNNER`, 1 when unset; anything but a number of 1 or more is an error, not a silent 1. */
export function slowness(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[SLOW_RUNNER_ENV]?.trim()
  if (raw === undefined || raw === '') return 1
  const factor = Number(raw)
  if (!Number.isFinite(factor) || factor < 1) throw new Error(`${SLOW_RUNNER_ENV}=${raw}: expected a factor of 1 or more`)
  return factor
}

/** The start of vitest's message for a test or a hook past its timeout: the only failure a slow runner retries. */
export const TIMED_OUT = /^(Test|Hook) timed out in \d+ms/

// vitest's own defaults of `testTimeout` and `hookTimeout`.
const TEST_TIMEOUT = 5_000
const HOOK_TIMEOUT = 10_000

/** What `vitest.config.ts` adds on a slow runner: the default timeouts scaled, one retry of a timed-out test. */
export function slowRunnerConfig(env: NodeJS.ProcessEnv = process.env) {
  const factor = slowness(env)
  if (factor === 1) return {}
  return { testTimeout: TEST_TIMEOUT * factor, hookTimeout: HOOK_TIMEOUT * factor, retry: { count: 1, condition: TIMED_OUT } }
}

/** An e2e test's or suite's own timeout, scaled on a slow runner: `{ timeout: scaled(60_000) }`. */
export function scaled(ms: number): number {
  return ms * slowness()
}
