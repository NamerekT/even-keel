import { describe, expect, it } from 'vitest'
import { accountDrift, mcpRows, settingRows, trimSettings } from './settings.js'

describe('trimSettings', () => {
  it('turns claude.ai sync off and hides the listed skills', () => {
    expect(trimSettings(['loop', 'init'], {}, {})).toEqual({
      syncClaudeAiSkills: false,
      syncClaudeAiPlugins: false,
      skillOverrides: { loop: 'user-invocable-only', init: 'user-invocable-only' },
    })
  })

  it('keeps what the project sets for a skill, the local file included, over the hidden list', () => {
    const project = { skillOverrides: { loop: 'on' } }
    const local = { skillOverrides: { dataviz: 'on', loop: 'off' } }
    expect(trimSettings(['loop', 'dataviz', 'init'], project, local).skillOverrides).toEqual({
      loop: 'on',
      dataviz: 'on',
      init: 'user-invocable-only',
    })
  })
})

describe('settingRows', () => {
  it('shows every place that sets a value and what a worktree session gets', () => {
    const rows = settingRows({
      user: { syncClaudeAiSkills: true, enabledPlugins: { 'huly@market': false, 'pw@market': true }, skillOverrides: { loop: 'user-invocable-only' } },
      project: { enabledPlugins: { 'huly@market': true } },
      local: { syncClaudeAiSkills: false, skillOverrides: { dataviz: 'on' } },
      chain: { syncClaudeAiSkills: false },
      chainMode: 'auto',
    })
    expect(rows).toEqual([
      { kind: 'sync', name: 'syncClaudeAiSkills', values: { user: 'on', local: 'off', chain: 'off' }, session: 'off' },
      { kind: 'mode', name: 'defaultMode', values: { chain: 'auto' }, session: 'auto' },
      { kind: 'plugin', name: 'huly@market', values: { user: 'off', project: 'on' }, session: 'on' },
      { kind: 'plugin', name: 'pw@market', values: { user: 'on' }, session: 'on' },
      { kind: 'skill', name: 'dataviz', values: { local: 'on' }, session: null },
      { kind: 'skill', name: 'loop', values: { user: 'user-invocable-only' }, session: 'user-invocable-only' },
    ])
  })

  it('joins permission rules of all places and marks the local-only ones', () => {
    const rows = settingRows({
      user: { permissions: { allow: ['Bash(git *)'], deny: ['Agent'], defaultMode: 'default' } },
      project: { permissions: { allow: ['Bash(git *)', 'mcp__huly'] } },
      local: { permissions: { allow: ['mcp__huly__add_issue_label'] } },
      localAllowed: ['WebFetch'],
    })
    expect(rows).toEqual([
      { kind: 'mode', name: 'defaultMode', values: { user: 'default' }, session: 'default' },
      { kind: 'permission', name: 'Agent', values: { user: 'deny' }, session: 'deny' },
      { kind: 'permission', name: 'Bash(git *)', values: { user: 'allow', project: 'allow' }, session: 'allow' },
      { kind: 'permission', name: 'mcp__huly', values: { project: 'allow' }, session: 'allow' },
      { kind: 'permission', name: 'mcp__huly__add_issue_label', values: { local: 'allow' }, session: null },
      { kind: 'permission', name: 'WebFetch', values: { local: 'allow' }, session: null },
    ])
  })
})

describe('mcpRows', () => {
  it('lists servers by scope and marks local ones as missing in a worktree', () => {
    const rows = mcpRows(
      {
        configs: [{ mcpServers: { forgejo: {} }, projects: { 'd:/repos/abc': { mcpServers: { db: {} }, disabledMcpServers: ['plugin:huly:huly'] } } }],
        repoServers: { docs: {} },
        plugins: [{ name: 'huly', servers: { huly: {} } }],
      },
      'D:\\repos\\abc',
      'win32',
    )
    expect(rows).toEqual([
      { name: 'forgejo', scope: 'user', plugin: null, disabled: false, worktree: true },
      { name: 'db', scope: 'local', plugin: null, disabled: false, worktree: false },
      { name: 'docs', scope: 'project', plugin: null, disabled: false, worktree: true },
      { name: 'huly', scope: 'plugin', plugin: 'huly', disabled: true, worktree: true },
    ])
  })
})

describe('accountDrift', () => {
  it('names the keys an account folder sets differently, without their values', () => {
    const global = { env: { TOKEN: 'a' }, model: 'opus', hooks: {} }
    expect(accountDrift(global, { env: { TOKEN: 'b' }, model: 'opus', theme: 'dark' })).toEqual(['env', 'hooks', 'theme'])
    expect(accountDrift(global, { ...global })).toEqual([])
  })
})
