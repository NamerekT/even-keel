import type { ReceivedView, SettingRow, ToolsView } from '../../../src/tools/model.js'

const HIDDEN = 'user-invocable-only'

/** `mode`: `bloated` — a session that got claude.ai skills, accounts that drift; `empty` — no session yet. */
export function fakeTools(project: string, trim: boolean, mode: string | null): ToolsView {
  const repo = `D:\\work\\${project.toLowerCase()}`
  const bloated = mode === 'bloated'
  const settings: SettingRow[] = [
    row('sync', 'syncClaudeAiPlugins', { local: 'off', ...(trim ? { chain: 'off' } : {}) }),
    row('sync', 'syncClaudeAiSkills', { local: 'off', ...(trim ? { chain: 'off' } : {}) }),
    row('mode', 'defaultMode', { user: 'default', chain: 'auto' }),
    row('plugin', 'huly@even-keel', { user: 'off', project: 'on' }),
    row('plugin', 'playwright@claude-plugins-official', { user: 'on' }),
    row('plugin', 'design@synced', { user: 'off' }),
    row('skill', 'dataviz', { local: 'on', ...(trim ? { chain: 'on' } : {}) }),
    row('skill', 'loop', { user: HIDDEN, ...(trim ? { chain: HIDDEN } : {}) }),
    row('skill', 'update-config', trim ? { chain: HIDDEN } : {}),
    row('permission', 'Agent', { user: 'deny' }),
    row('permission', 'Bash(git *)', { user: 'allow', project: 'allow' }),
    row('permission', 'mcp__plugin_huly_huly__add_issue_label', { local: 'allow' }),
  ].filter((each) => Object.keys(each.values).length > 0)

  return {
    project,
    repo,
    trim,
    settings,
    mcp: [
      { name: 'forgejo', scope: 'user', plugin: null, disabled: false, worktree: true },
      { name: 'db', scope: 'local', plugin: null, disabled: false, worktree: false },
      { name: 'huly', scope: 'plugin', plugin: 'huly', disabled: false, worktree: true },
      { name: 'playwright', scope: 'plugin', plugin: 'playwright', disabled: false, worktree: true },
    ],
    accounts: bloated
      ? [
          { account: 'john.doe', keys: ['enabledPlugins', 'env', 'hooks'] },
          { account: 'jane.doe', keys: ['skillOverrides'] },
        ]
      : [],
    received: mode === 'empty' ? null : received(repo, project, bloated),
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
