import type { TrackerAdapter } from '../tracker/source.js'
import { ALTERNATIVES, HOST_VARIABLES, issueUrlBase, readHulyCredentials, VARIABLES } from './credentials.js'

export const huly: TrackerAdapter = {
  title: 'Huly',
  variables: VARIABLES,
  hostVariables: HOST_VARIABLES,
  alternatives: ALTERNATIVES,
  help: 'https://github.com/hcengineering/platform/tree/develop/packages/api-client',
  mcpServer: 'huly',
  profileName: (values, account) => account?.name ?? `Huly · ${values.HULY_WORKSPACE ?? ''}`,
  account: async (values, timeoutMs) => (await import('./profile.js')).hulyAccount(values, timeoutMs),
  projects: async (values, query, timeoutMs) => (await import('./profile.js')).hulyProjects(values, query, timeoutMs),
  setup(env) {
    const credentials = readHulyCredentials(env)
    if (credentials === undefined) return undefined
    const base = issueUrlBase(credentials)
    return {
      connect: async (timeoutMs) => (await import('./source.js')).connectHuly(credentials, timeoutMs),
      issueUrl: () => `${base}{id}`,
    }
  },
}
