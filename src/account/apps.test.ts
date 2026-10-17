import { describe, expect, it } from 'vitest'
import { appSwitchProblem, configDirOf, vscodeChats, withConfigDir, type AppAccount } from './apps.js'
import type { AccountEntry, AccountView } from './model.js'
import { englishOf, notice, type Notice } from '../notice/notice.js'

const say = (problem: Notice | undefined) => (problem === undefined ? undefined : englishOf(problem))

const DIR = 'C:\\Users\\john\\.claude-accounts\\work'

const settings = (value: unknown, indent: string | number = 4) => `${JSON.stringify(value, null, indent)}\n`

describe('configDirOf', () => {
  it('reads CLAUDE_CONFIG_DIR from the Claude Code environment variables', () => {
    const text = settings({ 'editor.fontSize': 14, 'claudeCode.environmentVariables': [{ name: 'FOO', value: '1' }, { name: 'CLAUDE_CONFIG_DIR', value: DIR }] })
    expect(configDirOf(text)).toBe(DIR)
  })

  it('treats a missing or empty variable as the default folder', () => {
    expect(configDirOf(settings({ 'editor.fontSize': 14 }))).toBeNull()
    expect(configDirOf(settings({ 'claudeCode.environmentVariables': [{ name: 'CLAUDE_CONFIG_DIR', value: '' }] }))).toBeNull()
    expect(configDirOf('')).toBeNull()
  })

  it('refuses settings it cannot parse as plain JSON', () => {
    expect(() => configDirOf('{\n  // comment\n  "a": 1\n}')).toThrow(/plain JSON/)
  })
})

describe('withConfigDir', () => {
  it('adds the variable and keeps everything else', () => {
    const text = settings({ 'editor.fontSize': 14, 'claudeCode.environmentVariables': [{ name: 'FOO', value: '1' }] })
    expect(JSON.parse(withConfigDir(text, DIR))).toEqual({
      'editor.fontSize': 14,
      'claudeCode.environmentVariables': [{ name: 'FOO', value: '1' }, { name: 'CLAUDE_CONFIG_DIR', value: DIR }],
    })
  })

  it('replaces the folder in place', () => {
    const text = settings({ 'claudeCode.environmentVariables': [{ name: 'CLAUDE_CONFIG_DIR', value: 'C:\\old' }, { name: 'FOO', value: '1' }] })
    expect(JSON.parse(withConfigDir(text, DIR))['claudeCode.environmentVariables']).toEqual([
      { name: 'CLAUDE_CONFIG_DIR', value: DIR },
      { name: 'FOO', value: '1' },
    ])
  })

  it('drops the variable for the default folder, and the setting once it is empty', () => {
    const only = settings({ 'editor.fontSize': 14, 'claudeCode.environmentVariables': [{ name: 'CLAUDE_CONFIG_DIR', value: DIR }] })
    expect(JSON.parse(withConfigDir(only, null))).toEqual({ 'editor.fontSize': 14 })
    const more = settings({ 'claudeCode.environmentVariables': [{ name: 'CLAUDE_CONFIG_DIR', value: DIR }, { name: 'FOO', value: '1' }] })
    expect(JSON.parse(withConfigDir(more, null))).toEqual({ 'claudeCode.environmentVariables': [{ name: 'FOO', value: '1' }] })
  })

  it('keeps the indentation and the final newline of the file', () => {
    const tabs = settings({ a: 1 }, '\t')
    expect(withConfigDir(tabs, DIR)).toBe(settings({ a: 1, 'claudeCode.environmentVariables': [{ name: 'CLAUDE_CONFIG_DIR', value: DIR }] }, '\t'))
    expect(withConfigDir(JSON.stringify({ a: 1 }, null, 2), null)).toBe(JSON.stringify({ a: 1 }, null, 2))
  })

  it('starts a missing settings file', () => {
    expect(JSON.parse(withConfigDir('', DIR))).toEqual({ 'claudeCode.environmentVariables': [{ name: 'CLAUDE_CONFIG_DIR', value: DIR }] })
  })
})

describe('vscodeChats', () => {
  it('keeps only sessions started by the VS Code extension', () => {
    const chats = vscodeChats([
      { pid: 1, sessionId: 'aaaaaaaa-1', entrypoint: 'claude-vscode', name: 'example-90', status: 'idle' },
      { pid: 2, sessionId: 'bbbbbbbb-2', entrypoint: 'cli', name: 'ABC-1', status: 'busy' },
      { pid: 3, sessionId: 'cccccccc-3', entrypoint: 'claude-vscode', cwd: 'd:\\Projects\\Example' },
      { pid: 4, sessionId: 'dddddddd-4', entrypoint: 'claude-vscode' },
    ])
    expect(chats).toEqual([
      { name: 'example-90', status: 'idle' },
      { name: 'Example', status: null },
      { name: 'dddddddd', status: null },
    ])
  })
})

const account = (patch: Partial<AccountEntry>): AccountEntry => ({
  key: 'global',
  global: true,
  status: { loggedIn: true, authMethod: 'claude.ai', email: 'john.doe@example.com', orgName: null, subscriptionType: 'max' },
  error: null,
  loginExpiresAt: null,
  needsLogin: false,
  sessions: [],
  removing: false,
  configPending: false,
  apiKey: false,
  limits: null,
  usage: { state: 'ok', reason: null, since: null },
  ...patch,
})

const vscode = (patch: Partial<AppAccount>): AppAccount => ({ app: 'vscode', account: 'global', dir: null, error: null, sessions: [], ...patch })

const view = (app: AppAccount, accounts: AccountEntry[] = [account({}), account({ key: 'work', global: false })]): AccountView => ({
  active: 'global',
  accounts,
  login: null,
  loginBlock: null,
  apps: [app],
})

describe('appSwitchProblem', () => {
  it('lets VS Code without open chats move to a signed-in account', () => {
    expect(appSwitchProblem(view(vscode({})), 'vscode', 'work')).toBeUndefined()
    expect(appSwitchProblem(view(vscode({ account: null, dir: 'C:\\elsewhere' })), 'vscode', 'global')).toBeUndefined()
  })

  it('does not care about the chain or Even Keel sessions', () => {
    const busy = { ...view(vscode({})), loginBlock: { chains: ['ABC'], sessions: [] } }
    expect(appSwitchProblem(busy, 'vscode', 'work')).toBeUndefined()
  })

  it('refuses while VS Code has Claude chats open', () => {
    const open = view(vscode({ sessions: [{ name: 'example-90', status: 'idle' }, { name: 'Example', status: 'busy' }] }))
    expect(say(appSwitchProblem(open, 'vscode', 'work'))).toMatch(/example-90, Example/)
  })

  it('refuses an unknown app or account, the current one and an account that cannot be used', () => {
    expect(say(appSwitchProblem(view(vscode({})), 'cursor', 'work'))).toMatch(/no app/)
    expect(say(appSwitchProblem(view(vscode({})), 'vscode', 'nope'))).toMatch(/no account/)
    expect(say(appSwitchProblem(view(vscode({ account: 'work' })), 'vscode', 'work'))).toMatch(/already/)
    expect(say(appSwitchProblem(view(vscode({}), [account({}), account({ key: 'work', global: false, needsLogin: true })]), 'vscode', 'work'))).toMatch(/login/)
    expect(say(appSwitchProblem(view(vscode({}), [account({}), account({ key: 'work', global: false, removing: true })]), 'vscode', 'work'))).toMatch(/removed/)
  })

  it('refuses while the settings could not be read', () => {
    expect(say(appSwitchProblem(view(vscode({ error: notice('vscode.notJson', {}) })), 'vscode', 'work'))).toMatch(/plain JSON/)
  })
})
