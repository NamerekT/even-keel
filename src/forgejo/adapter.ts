import { FORGEJO_TOKEN, FORGEJO_URL, forgejoAccount, forgejoBase, forgejoName, hostOf } from '../ci/forgejo-profile.js'
import type { TrackerAdapter } from '../tracker/source.js'

/**
 * Forgejo Issues (BTN-476), and through the same Gitea API Gitea and Codeberg. One profile serves the tracker, the CI of
 * the remotes on its host (`ciToken`) and their pull requests; it was a CI's kind only before (BTN-201), and a stored
 * profile is a tracker's as it is. The task id is `<KEY>-<index>`, the repository's `owner/name` is the project's `forgejo`.
 */
export const forgejo: TrackerAdapter = {
  title: 'Forgejo',
  variables: [FORGEJO_URL, FORGEJO_TOKEN],
  hostVariables: [FORGEJO_URL],
  help: 'https://forgejo.org/docs/latest/user/token-scope/',
  mcpServer: 'forgejo',
  editsTasks: true,
  mcpKeys: { GITEA_ACCESS_TOKEN: FORGEJO_TOKEN },
  // gitea-mcp wants the address with its scheme; a profile may hold the host alone.
  mcpValues: { GITEA_HOST: { from: [FORGEJO_URL], value: (env) => (env[FORGEJO_URL] ? forgejoBase(env[FORGEJO_URL]) : undefined) } },
  profileName: (values) => forgejoName(values[FORGEJO_URL] ?? ''),
  account: (values, timeoutMs) => forgejoAccount(values, timeoutMs),
  projects: async (values, query, timeoutMs) => (await import('./profile.js')).forgejoProjects(values, query, timeoutMs),
  projectKey: { key: 'forgejo', pattern: /^[\w.-]+\/[\w.-]+$/, example: 'owner/name' },
  // Only a remote on the profile's own host: an `owner/name` of another server names no repository the profile reads.
  projectOfRemote(remote, _url, env) {
    const url = env[FORGEJO_URL]
    return url && hostOf(url) === remote.host.toLowerCase() ? `${remote.owner}/${remote.repo}` : undefined
  },
  setup(env, projects) {
    const url = env[FORGEJO_URL]
    const token = env[FORGEJO_TOKEN]
    if (!url && !token) return undefined
    if (!url || !token) throw new Error(`forgejo: ${FORGEJO_URL} and ${FORGEJO_TOKEN} go together`)
    if (hostOf(url) === null) throw new Error(`forgejo: ${FORGEJO_URL} is not an address: ${url}`)
    const web = forgejoBase(url)
    const slugOf = (project: string | null) => (project === null || !Object.hasOwn(projects, project) ? undefined : projects[project]!.value)
    return {
      connect: async (timeoutMs) => (await import('./source.js')).connectForgejo({ web, token, projects }, timeoutMs),
      issueUrl: (project) => {
        const slug = slugOf(project)
        return slug === undefined ? null : `${web}/${slug}/issues/{number}`
      },
      projectUrl: (project) => {
        const slug = slugOf(project)
        return slug === undefined ? null : `${web}/${slug}/issues`
      },
    }
  },
}
