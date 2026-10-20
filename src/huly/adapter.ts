import type { TrackerAdapter } from '../tracker/source.js'
import { ALTERNATIVES, HOST_VARIABLES, issueUrlBase, readHulyCredentials, VARIABLES } from './credentials.js'

export const huly: TrackerAdapter = {
  title: 'Huly',
  variables: VARIABLES,
  hostVariables: HOST_VARIABLES,
  alternatives: ALTERNATIVES,
  help: 'https://github.com/NamerekT/even-keel/blob/main/plugins/huly/README.md#credentials',
  mcpServer: 'huly',
  profileName: (values, account) => account?.name ?? `Huly · ${values.HULY_WORKSPACE ?? ''}`,
  account: async (values, timeoutMs) => (await import('./profile.js')).hulyAccount(values, timeoutMs),
  projects: async (values, query, timeoutMs) => (await import('./profile.js')).hulyProjects(values, query, timeoutMs),
  setup(env) {
    const credentials = readHulyCredentials(env)
    if (credentials === undefined) return undefined
    const base = issueUrlBase(credentials)
    let projectIds: ReadonlyMap<string, string> = new Map()
    return {
      connect: async (timeoutMs) => {
        const source = await (await import('./source.js')).connectHuly(credentials, timeoutMs)
        projectIds = source.projectIds
        return source
      },
      issueUrl: () => `${base}{id}`,
      projectUrl: (project) => {
        const id = projectIds.get(project)
        return id === undefined ? null : `${base}${id}/issues`
      },
    }
  },
}
