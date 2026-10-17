import { ciVariables } from '../ci/adapters.js'
import { trackerVariables } from '../tracker/adapters.js'

/** The service's environment without the trackers' and CIs' credentials: an agent adds its own variables on top (`Agent.env`). */
export function sessionBase(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base = { ...env }
  for (const name of [...trackerVariables(), ...ciVariables()]) delete base[name]
  return base
}
