import { describe, expect, it } from 'vitest'
import type { SettingKind, SettingRow } from './model.js'
import { accountDrift, forPackageOff, settingRows, trimSettings } from './settings.js'

describe('trimSettings', () => {
  it('turns claude.ai sync off and hides the listed skills', () => {
    expect(trimSettings(['loop', 'init'], {}, {})).toEqual({
      syncClaudeAiSkills: false,
      syncClaudeAiPlugins: false,
      skillOverrides: { loop: 'user-invocable-only', init: 'user-invocable-only' },
    })
  })

  it('keeps what the project sets for a skill, the local file winning as in the CLI, over the hidden list', () => {
    const project = { skillOverrides: { loop: 'on', init: 'on' } }
    const local = { skillOverrides: { dataviz: 'on', loop: 'off' } }
    expect(trimSettings(['loop', 'dataviz', 'init', 'schedule'], project, local).skillOverrides).toEqual({
      loop: 'off',
      dataviz: 'on',
      init: 'on',
      schedule: 'user-invocable-only',
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

describe('forPackageOff', () => {
  const reach = { plugins: ['huly@even-keel'], servers: ['plugin_huly_huly', 'github'] }
  const local = (kind: SettingKind, name: string): SettingRow => ({ kind, name, values: { local: 'allow' }, session: null })

  it('takes a local-only plugin or MCP permission of a package the sessions do not get', () => {
    expect(forPackageOff(local('plugin', 'design@knowledge-work-plugins'), reach)).toBe(true)
    expect(forPackageOff(local('permission', 'mcp__strata__strata_brief'), reach)).toBe(true)
    expect(forPackageOff(local('permission', 'mcp__strata'), reach)).toBe(true)
    expect(forPackageOff(local('permission', 'mcp__plugin_design_figma__export'), reach)).toBe(true)
  })

  it('keeps one of a package the sessions get: by the plugin, by the server', () => {
    expect(forPackageOff(local('plugin', 'huly@even-keel'), reach)).toBe(false)
    expect(forPackageOff(local('permission', 'mcp__github__get_issue'), reach)).toBe(false)
    expect(forPackageOff(local('permission', 'mcp__plugin_huly_huly__get_issue'), reach)).toBe(false)
    expect(forPackageOff(local('permission', 'mcp__plugin_huly_other__list'), reach)).toBe(false)
  })

  it('keeps what no package brings and what reaches the session', () => {
    expect(forPackageOff(local('permission', 'WebFetch'), reach)).toBe(false)
    expect(forPackageOff(local('skill', 'dataviz'), reach)).toBe(false)
    expect(forPackageOff({ kind: 'plugin', name: 'design@knowledge-work-plugins', values: { user: 'on' }, session: 'on' }, reach)).toBe(false)
  })
})

describe('accountDrift', () => {
  it('names the keys an account folder sets differently, without their values', () => {
    const global = { env: { TOKEN: 'a' }, model: 'opus', hooks: {} }
    expect(accountDrift(global, { env: { TOKEN: 'b' }, model: 'opus', theme: 'dark' })).toEqual(['env', 'hooks', 'theme'])
    expect(accountDrift(global, { ...global })).toEqual([])
  })
})
