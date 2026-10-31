import type { TrackerAdapter } from '../tracker/source.js'
import { linearPlace } from './model.js'

export const LINEAR_TOKEN = 'LINEAR_TOKEN'

export const linear: TrackerAdapter = {
  title: 'Linear',
  variables: [LINEAR_TOKEN],
  hostVariables: [],
  help: 'https://linear.app/settings/account/security',
  mcpServer: 'linear',
  moves: true,
  profileName: (_values, account) => account?.name ?? 'Linear',
  account: async (values, timeoutMs) => (await import('./profile.js')).linearAccount(values, timeoutMs),
  projects: async (values, query, timeoutMs) => (await import('./profile.js')).linearProjects(values, query, timeoutMs),
  mcpKeys: { LINEAR_API_KEY: LINEAR_TOKEN },
  projectKey: {
    key: 'linear',
    optional: true,
    pattern: /\S/,
    example: 'Web app',
    placeOf: (key, value) => {
      const { team, project } = linearPlace(key, value)
      return { read: `${team}/${project ?? ''}`, ids: team }
    },
  },
  setup(env, projects) {
    const token = env[LINEAR_TOKEN]
    if (!token) return undefined
    let urlKey: string | null = null
    let projectUrls: ReadonlyMap<string, string> = new Map()
    return {
      connect: async (timeoutMs) => {
        const source = await (await import('./source.js')).connectLinear({ token, projects }, timeoutMs)
        urlKey = source.urlKey
        projectUrls = source.projectUrls
        return source
      },
      issueUrl: () => (urlKey === null ? null : `https://linear.app/${urlKey}/issue/{id}`),
      // A project narrowed to a Linear project leads to that project, not to the whole team.
      projectUrl: (id) => {
        const place = projects[id]
        if (place === undefined) return null
        const { team, project } = linearPlace(place.key, place.value)
        if (project !== null) return projectUrls.get(id) ?? null
        return urlKey === null ? null : `https://linear.app/${urlKey}/team/${encodeURIComponent(team)}/all`
      },
    }
  },
}
