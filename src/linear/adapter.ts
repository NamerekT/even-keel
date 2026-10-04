import type { TrackerAdapter } from '../tracker/source.js'

export const LINEAR_TOKEN = 'LINEAR_TOKEN'

export const linear: TrackerAdapter = {
  title: 'Linear',
  variables: [LINEAR_TOKEN],
  mcpServer: 'linear',
  projectKey: { key: 'linear', optional: true, pattern: /\S/, example: 'Web app' },
  setup(env, projects) {
    const token = env[LINEAR_TOKEN]
    if (!token) return undefined
    let urlKey: string | null = null
    return {
      connect: async (timeoutMs) => {
        const source = await (await import('./source.js')).connectLinear({ token, projects }, timeoutMs)
        urlKey = source.urlKey
        return source
      },
      issueUrl: () => (urlKey === null ? null : `https://linear.app/${urlKey}/issue/{id}`),
    }
  },
}
