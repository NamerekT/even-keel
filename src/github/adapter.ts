import type { TrackerAdapter } from '../tracker/source.js'

export const GITHUB_TOKEN = 'GITHUB_TOKEN'

export const github: TrackerAdapter = {
  title: 'GitHub',
  variables: [GITHUB_TOKEN],
  hostVariables: [],
  help: 'https://github.com/settings/personal-access-tokens/new',
  mcpServer: 'github',
  profileName: (_values, account) => account?.name ?? 'GitHub',
  account: async (values, timeoutMs) => (await import('./profile.js')).githubAccount(values, timeoutMs),
  projects: async (values, query, timeoutMs) => (await import('./profile.js')).githubProjects(values, query, timeoutMs),
  mcpKeys: { GITHUB_PERSONAL_ACCESS_TOKEN: GITHUB_TOKEN },
  projectKey: { key: 'github', pattern: /^[\w.-]+\/[\w.-]+$/, example: 'octo-org/example' },
  setup(env, projects) {
    const token = env[GITHUB_TOKEN]
    if (!token) return undefined
    return {
      connect: async (timeoutMs) => (await import('./source.js')).connectGithub({ token, projects }, timeoutMs),
      issueUrl: (project) => (project !== null && Object.hasOwn(projects, project) ? `https://github.com/${projects[project]}/issues/{number}` : null),
    }
  },
}
