import { hostOf } from '../ci/host.js'
import { gitlabRepo } from '../ci/remote.js'
import { fail } from '../notice/notice.js'
import type { TrackerAdapter } from '../tracker/source.js'
import { GITLAB_TOKEN, GITLAB_URL, webUrl } from './api.js'

export const gitlab: TrackerAdapter = {
  title: 'GitLab',
  variables: [GITLAB_URL, GITLAB_TOKEN],
  hostVariables: [GITLAB_URL],
  help: 'https://docs.gitlab.com/user/profile/personal_access_tokens/',
  mcpServer: 'gitlab',
  mcpKeys: { GITLAB_PERSONAL_ACCESS_TOKEN: GITLAB_TOKEN },
  profileName: (_values, account) => account?.name ?? 'GitLab',
  account: async (values, timeoutMs) => (await import('./profile.js')).gitlabAccount(values, timeoutMs),
  projects: async (values, query, timeoutMs) => (await import('./profile.js')).gitlabProjects(values, query, timeoutMs),
  projectKey: { key: 'gitlab', pattern: /^[\w-][\w.-]*(?:\/[\w-][\w.-]*)+$/, example: 'group/subgroup/project' },
  // Only a remote on the profile's own server: a path of another installation names no project the profile can read.
  projectOfRemote(remote, url, env) {
    let web: string
    try {
      web = webUrl(env)
    } catch {
      return undefined
    }
    if (hostOf(web) !== remote.host.toLowerCase()) return undefined
    const repo = gitlabRepo(url, remote.host, [web])
    return repo === null ? undefined : `${repo.owner}/${repo.repo}`
  },
  setup(env, projects) {
    const token = env[GITLAB_TOKEN]
    if (!token) {
      if (env[GITLAB_URL]) throw fail('gitlab.token', {})
      return undefined
    }
    const web = webUrl(env)
    const projectUrl = (id: string) => {
      const path = Object.hasOwn(projects, id) ? projects[id]!.value : undefined
      return path === undefined ? null : `${web}/${path}/-/issues`
    }
    return {
      connect: async (timeoutMs) => (await import('./source.js')).connectGitlab({ web, token, projects }, timeoutMs),
      issueUrl: (id) => {
        const url = id === null ? null : projectUrl(id)
        return url === null ? null : `${url}/{number}`
      },
      projectUrl,
    }
  },
}
