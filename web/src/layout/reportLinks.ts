import type { CliCopyView } from '../../../src/agent/cli-state.js'

/** The agents as the issue forms' "Agent" dropdowns name them (`.github/ISSUE_TEMPLATE/*.yml`). */
const FORM_AGENTS: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', copilot: 'GitHub Copilot' }

/** The repository's page out of the `repository.url` of `package.json` (`git+https://…/x.git`). */
export function repositoryUrl(gitUrl: string): string {
  return gitUrl.replace(/^git\+/, '').replace(/\.git$/, '')
}

/** The version an agent's sessions run on: Even Keel's copy once it is ready, the installed CLI otherwise. */
function runningVersion(copy: CliCopyView): string | null {
  if (copy.status === 'ready' && copy.source === 'checked') return copy.version
  if (copy.status === 'ready' && copy.source === 'latest' && copy.latest != null) return copy.latest
  return copy.installed ?? null
}

/** Every agent with a known CLI version, "Claude Code 2.1.0, Codex 0.9.0", the default provider first; empty without any. */
export function cliLine(copies: Record<string, CliCopyView> | undefined, provider: string): string {
  const agents = Object.keys(copies ?? {}).sort((a, b) => Number(b === provider) - Number(a === provider))
  return agents
    .flatMap((agent) => {
      const version = runningVersion(copies![agent]!)
      return version === null ? [] : [`${FORM_AGENTS[agent] ?? agent} ${version}`]
    })
    .join(', ')
}

export interface ReportFacts {
  repository: string
  version: string
  cli: string
}

/**
 * The places "Report a problem" leads to (BTN-1494). The issue forms get their text fields by `id` from the address;
 * the dropdowns (OS, agent, how it runs, tracker) stay empty: GitHub's form takes no dropdown from the address
 * (checked 2026-11-25, `docs/verified/page.md`). Nothing is sent: the person sees the form and decides.
 */
export function reportLinks({ repository, version, cli }: ReportFacts) {
  const form = (template: string, fields: Record<string, string>) => {
    const query = new URLSearchParams({ template })
    for (const [id, value] of Object.entries(fields)) if (value !== '') query.set(id, value)
    return `${repository}/issues/new?${query}`
  }
  return {
    bug: form('bug.yml', { version, cli }),
    cliUpdate: form('cli-update.yml', { version, 'cli-now': cli }),
    setup: form('setup.yml', {}),
    discussions: `${repository}/discussions/new/choose`,
    security: `${repository}/security/advisories/new`,
  }
}
