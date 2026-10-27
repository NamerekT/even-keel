import { fail } from '../notice/notice.js'
import type { TrackerAdapter } from '../tracker/source.js'
import { basicAuth, JIRA_EMAIL, JIRA_MCP_TOKEN, JIRA_TOKEN, JIRA_URL, siteUrl } from './api.js'

const VARIABLES = [JIRA_URL, JIRA_EMAIL, JIRA_TOKEN] as const

export const jira: TrackerAdapter = {
  title: 'Jira',
  variables: [...VARIABLES, JIRA_MCP_TOKEN],
  hostVariables: [JIRA_URL],
  help: 'https://id.atlassian.com/manage-profile/security/api-tokens',
  mcpServer: 'jira',
  // Atlassian's MCP server takes an API token only as a Basic header of the e-mail and the token.
  mcpValues: {
    JIRA_BASIC_AUTH: {
      from: [JIRA_EMAIL, JIRA_MCP_TOKEN],
      value: (env) => (env[JIRA_EMAIL] && env[JIRA_MCP_TOKEN] ? basicAuth(env[JIRA_EMAIL], env[JIRA_MCP_TOKEN]) : undefined),
    },
  },
  profileName: (_values, account) => account?.name ?? 'Jira',
  account: async (values, timeoutMs) => (await import('./profile.js')).jiraAccount(values, timeoutMs),
  projects: async (values, query, timeoutMs) => (await import('./profile.js')).jiraProjects(values, query, timeoutMs),
  setup(env, projects) {
    const set = VARIABLES.filter((name) => env[name])
    if (set.length === 0 && !env[JIRA_MCP_TOKEN]) return undefined
    if (set.length < VARIABLES.length) throw fail('jira.incomplete', {})
    const site = siteUrl(env)
    const values = Object.fromEntries(VARIABLES.map((name) => [name, env[name]]))
    return {
      connect: async (timeoutMs) => (await import('./source.js')).connectJira({ values, projects }, timeoutMs),
      issueUrl: () => `${site}/browse/{id}`,
      projectUrl: (id) => (Object.hasOwn(projects, id) ? `${site}/browse/${encodeURIComponent(projects[id]!.key)}` : null),
    }
  },
}
