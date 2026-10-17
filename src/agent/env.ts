import { ciVariables } from '../ci/adapters.js'
import { trackerVariables } from '../tracker/adapters.js'

/**
 * The service's environment without the trackers' and CIs' credentials and the keys of the packages (`keys`): an agent
 * adds its own variables on top (`Agent.env`).
 */
export function sessionBase(env: NodeJS.ProcessEnv, keys: readonly string[] = []): NodeJS.ProcessEnv {
  const base = { ...env }
  for (const name of [...trackerVariables(), ...ciVariables(), ...keys]) delete base[name]
  return base
}
