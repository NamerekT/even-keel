import type { TrackerAdapter } from '../tracker/source.js'
import { ALTERNATIVES, HOST_VARIABLES, issueUrlBase, readHulyCredentials, VARIABLES } from './credentials.js'

export const huly: TrackerAdapter = {
  title: 'Huly',
  variables: VARIABLES,
  hostVariables: HOST_VARIABLES,
  alternatives: ALTERNATIVES,
  help: 'https://github.com/NamerekT/even-keel/blob/main/plugins/huly/README.md#credentials',
  mcpServer: 'huly',
  moves: true,
  profileName: (values, account) => account?.name ?? `Huly · ${values.HULY_WORKSPACE ?? ''}`,
  account: async (values, timeoutMs) => (await import('./profile.js')).hulyAccount(values, timeoutMs),
  projects: async (values, query, timeoutMs) => (await import('./profile.js')).hulyProjects(values, query, timeoutMs),
  projectKey: { key: 'huly', optional: true, alias: true, pattern: /^[A-Z][A-Z0-9_]{0,4}$/, example: 'ABC', placeOf: (key, value) => ({ read: value ?? key, ids: value ?? key }) },
  setup(env, projects) {
    const credentials = readHulyCredentials(env)
    if (credentials === undefined) return undefined
    const base = issueUrlBase(credentials)
    let projectIds: ReadonlyMap<string, string> = new Map()
    return {
      connect: async (timeoutMs) => {
        const source = await (await import('./source.js')).connectHuly(credentials, timeoutMs, projects)
        projectIds = source.projectIds
        return source
      },
      issueUrl: () => `${base}{id}`,
      projectUrl: (project) => {
        const place = projects[project]
        const id = place === undefined ? undefined : projectIds.get(place.value ?? place.key)
        return id === undefined ? null : `${base}${id}/issues`
      },
    }
  },
}
