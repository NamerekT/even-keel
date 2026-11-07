import { ciVariables } from '../ci/adapters.js'
import { trackerVariables } from '../tracker/adapters.js'

/** The trackers' and CIs' credentials and the keys of the packages (`keys`): no session gets them. */
export function sessionSecrets(keys: readonly string[] = []): string[] {
  return [...new Set([...trackerVariables(), ...ciVariables(), ...keys])]
}

/**
 * The service's environment without the trackers' and CIs' credentials and the keys of the packages (`keys`): an agent
 * adds its own variables on top (`Agent.env`).
 */
export function sessionBase(env: NodeJS.ProcessEnv, keys: readonly string[] = []): NodeJS.ProcessEnv {
  const base = { ...env }
  for (const name of sessionSecrets(keys)) delete base[name]
  return base
}

/**
 * An agent's environment for its sessions: `sessionBase` and the service's own address `url` as `EVEN_KEEL_URL`,
 * the only way the packages' hooks find the service off its default port (BTN-817).
 */
export function sessionEnv(env: NodeJS.ProcessEnv, keys: readonly string[], url: string): NodeJS.ProcessEnv {
  return { ...sessionBase(env, keys), EVEN_KEEL_URL: url }
}

/** Which of `names` the `env` of a parsed `settings.json` sets: the CLI puts it on top of a session's environment. */
export function settingsSecrets(settings: unknown, names: readonly string[]): string[] {
  const env = typeof settings === 'object' && settings !== null ? (settings as { env?: unknown }).env : undefined
  if (typeof env !== 'object' || env === null || Array.isArray(env)) return []
  return names.filter((name) => Object.hasOwn(env, name))
}
