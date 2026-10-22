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
  projectOfRemote: (remote) => (remote.host === 'github.com' ? `${remote.owner}/${remote.repo}` : undefined),
  setup(env, projects) {
    const token = env[GITHUB_TOKEN]
    if (!token) return undefined
    return {
      connect: async (timeoutMs) => (await import('./source.js')).connectGithub({ token, projects }, timeoutMs),
      issueUrl: (project) => {
        const slug = project === null || !Object.hasOwn(projects, project) ? undefined : projects[project]!.value
        return slug === undefined ? null : `https://github.com/${slug}/issues/{number}`
      },
      projectUrl: (project) => {
        const slug = Object.hasOwn(projects, project) ? projects[project]!.value : undefined
        return slug === undefined ? null : `https://github.com/${slug}/issues`
      },
    }
  },
}
