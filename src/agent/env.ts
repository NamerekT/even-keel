import { ciVariables } from '../ci/adapters.js'
import { secretCatalog } from '../secrets/catalog.js'
import { trackerKeyRules, trackerVariables } from '../tracker/adapters.js'

/**
 * The names no session gets: the trackers' and CIs' credentials, the placeholders the MCP gateway also reads a tracker's
 * key under (`GITHUB_PERSONAL_ACCESS_TOKEN`, `JIRA_BASIC_AUTH`), Even Keel's own secrets (the page token, Tally's, the
 * badge's) and the keys of the packages (`keys`).
 */
export function sessionSecrets(keys: readonly string[] = []): string[] {
  const rules = trackerKeyRules()
  const own = secretCatalog().filter((spec) => spec.secret).map((spec) => spec.name)
  return [...new Set([...trackerVariables(), ...ciVariables(), ...Object.keys(rules.aliases), ...Object.keys(rules.derived ?? {}), ...own, ...keys])]
}

/**
 * The service's environment without `sessionSecrets(keys)` and without the variables Even Keel's `.env` put there
 * (`file`, `EnvFile.own`): a session and a package's server need nothing of that file (BTN-1115). An agent adds its own
 * variables on top (`Agent.env`).
 */
export function sessionBase(env: NodeJS.ProcessEnv, keys: readonly string[] = [], file: readonly string[] = []): NodeJS.ProcessEnv {
  const base = { ...env }
  for (const name of [...sessionSecrets(keys), ...file]) delete base[name]
  return base
}

/**
 * An agent's environment for its sessions: `sessionBase` and the service's own address `url` as `EVEN_KEEL_URL`,
 * the only way the packages' hooks find the service off its default port (BTN-817).
 */
export function sessionEnv(env: NodeJS.ProcessEnv, keys: readonly string[], url: string, file: readonly string[] = []): NodeJS.ProcessEnv {
  return { ...sessionBase(env, keys, file), EVEN_KEEL_URL: url }
}

/** Which of `names` the `env` of a parsed `settings.json` sets: the CLI puts it on top of a session's environment. */
export function settingsSecrets(settings: unknown, names: readonly string[]): string[] {
  const env = typeof settings === 'object' && settings !== null ? (settings as { env?: unknown }).env : undefined
  if (typeof env !== 'object' || env === null || Array.isArray(env)) return []
  return names.filter((name) => Object.hasOwn(env, name))
}
