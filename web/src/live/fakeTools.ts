import type { ReceivedView, SettingRow, ToolsView } from '../../../src/tools/model.js'
import { forPackageOff } from '../../../src/tools/settings.js'

const HIDDEN = 'user-invocable-only'
/** The packages the fake projects have on: the design plugin and `strata` set only in `local` are left out, as the service does. */
const REACH = { plugins: ['huly@even-keel', 'playwright@claude-plugins-official'], servers: ['plugin_huly_huly', 'plugin_playwright_playwright'] }

/**
 * `mode`: `bloated` — a session that got claude.ai skills, accounts that drift; `empty` — no session yet.
 * Projects whose key starts with an odd letter code differ a little, so that the comparison has something to show.
 */
export function fakeTools(project: string, trim: boolean, mode: string | null): ToolsView {
  const repo = `D:\\work\\${project.toLowerCase()}`
  const bloated = mode === 'bloated'
  const odd = project.charCodeAt(0) % 2 === 1
  const settings: SettingRow[] = [
    row('sync', 'syncClaudeAiPlugins', { local: 'off', ...(trim ? { chain: 'off' } : {}) }),
    row('sync', 'syncClaudeAiSkills', { local: 'off', ...(trim ? { chain: 'off' } : {}) }),
    row('mode', 'defaultMode', { user: 'default', chain: 'auto' }),
    row('plugin', 'huly@even-keel', { user: 'off', project: 'on' }),
    row('plugin', 'playwright@claude-plugins-official', { user: 'on', ...(odd ? { project: 'off' } : {}) }),
    row('plugin', 'design@synced', { user: 'off' }),
    row('skill', 'dataviz', odd ? {} : { local: 'on', ...(trim ? { chain: 'on' } : {}) }),
    row('skill', 'loop', { user: HIDDEN, ...(trim ? { chain: HIDDEN } : {}) }),
    row('skill', 'update-config', trim ? { chain: HIDDEN } : {}),
    row('permission', 'Agent', { user: 'deny' }),
    row('permission', 'Bash(git *)', { user: 'allow', project: 'allow' }),
    row('permission', 'Bash(npm test *)', odd ? { project: 'allow' } : {}),
    row('permission', 'mcp__plugin_huly_huly__add_issue_label', { local: 'allow' }),
    row('plugin', 'design@knowledge-work-plugins', { local: 'on' }),
    row('permission', 'mcp__strata__strata_search', { local: 'allow' }),
  ].filter((each) => Object.keys(each.values).length > 0 && !forPackageOff(each, REACH))

  return {
    project,
    repo,
    trim,
    settings,
    accounts: bloated
      ? [
          { account: 'john.doe', keys: ['enabledPlugins', 'env', 'hooks'] },
          { account: 'jane.doe', keys: ['skillOverrides'] },
        ]
      : [],
    received: mode === 'empty' ? null : received(repo, project, bloated),
    rules:
      mode === 'empty'
        ? { files: [], skills: [] }
        : odd
          ? { files: ['AGENTS.md'], skills: [{ folder: '.agents/skills', names: ['release'] }] }
          : { files: ['CLAUDE.md', 'AGENTS.md'], skills: [{ folder: '.claude/skills', names: ['migrate', 'review'] }] },
  }
}

function row(kind: SettingRow['kind'], name: string, values: SettingRow['values']): SettingRow {
  return { kind, name, values, session: values.chain ?? values.project ?? values.user ?? null }
}

function received(repo: string, project: string, bloated: boolean): ReceivedView {
  const claudeAi = ['docx', 'pdf', 'pptx', 'xlsx', 'email-writing', 'morning', 'deep-research', 'skill-creator']
  return {
    sessionId: '7f3c9a1e-0b2d-4e5f-8a6b-1c2d3e4f5a6b',
    cwd: `${repo}\\.claude\\worktrees\\${project.toLowerCase()}-5`,
    at: new Date(Date.now() - 42 * 60_000).toISOString(),
    version: '2.1.290',
    mode: 'auto',
    account: 'jane.roe@example.com',
    skills: [
      { name: 'coding', source: 'user' },
      { name: 'huly-tracker', source: 'user' },
      { name: 'replay-save', source: 'project' },
      { name: 'huly:task', source: 'plugin' },
      { name: 'huly:split', source: 'plugin' },
      { name: 'code-review', source: 'bundled' },
      { name: 'simplify', source: 'bundled' },
      { name: 'run', source: 'bundled' },
      ...(bloated ? claudeAi.map((name) => ({ name: `anthropic-skills:${name}`, source: 'claudeai' as const })) : []),
    ],
    listingChars: bloated ? 22_756 : 5_480,
    tools: ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Skill', 'ToolSearch', 'Write', 'WebFetch', 'WebSearch', 'Monitor', 'TaskStop'],
    mcp: [
      { name: 'plugin_huly_huly', tools: 96, failed: false },
      { name: 'plugin_playwright_playwright', tools: 25, failed: false },
      ...(bloated ? [{ name: 'forgejo', tools: 0, failed: true }] : []),
    ],
  }
}
