import type { TrackerAdapter } from '../tracker/source.js'
import { issueUrlBase, readHulyCredentials, VARIABLES } from './credentials.js'

export const huly: TrackerAdapter = {
  title: 'Huly',
  variables: VARIABLES,
  setup(env) {
    const credentials = readHulyCredentials(env)
    if (credentials === undefined) return undefined
    return {
      connect: async (timeoutMs) => (await import('./source.js')).connectHuly(credentials, timeoutMs),
      issueUrlBase: issueUrlBase(credentials),
    }
  },
}
