import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { editedKeys } from './settingsLayer.js'
import { shareConfig } from './share.js'
import { guardSettingsEdit, removeAccountSettingsGuards, removeSettingsGuard, stripSettingsGuard, withSettingsGuard } from './settingsGuard.js'

describe('the managed account settings guard', () => {
  let root: string
  let global: { dir: string; config: string }
  let folder: string
  const userHook = { matcher: 'Write', hooks: [{ type: 'command', command: 'echo user' }] }
  const read = () => JSON.parse(readFileSync(join(folder, 'settings.json'), 'utf8'))
  const config = () => ({ accountsDir: root, globalDir: global.dir, url: 'http://127.0.0.1:4747' })

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'even-keel-guard-'))
    global = { dir: join(root, 'global'), config: join(root, '.claude.json') }
    folder = join(root, 'example')
    mkdirSync(global.dir)
    mkdirSync(folder)
    writeFileSync(join(global.dir, 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [userHook] } }))
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('installs once, preserves global hooks, and never writes the global file', () => {
    shareConfig(global, folder)
    expect(read().hooks.PreToolUse).toHaveLength(2)
    expect(read().hooks.PreToolUse[0]).toEqual(userHook)
    expect(shareConfig(global, folder)).toBe(false)
    expect(read().hooks.PreToolUse).toHaveLength(2)
    expect(JSON.parse(readFileSync(join(global.dir, 'settings.json'), 'utf8')).hooks.PreToolUse).toEqual([userHook])
  })

  it('replaces its old command, including in a mixed user group, and keeps only user changes visible', () => {
    const guarded = withSettingsGuard({ model: 'opus', hooks: { PreToolUse: [structuredClone(userHook)] } }, config())
    const hooks = guarded.hooks as { PreToolUse: typeof userHook[] }
    hooks.PreToolUse[0]!.hooks.push(...hooks.PreToolUse.pop()!.hooks)
    const next = withSettingsGuard(guarded, { ...config(), url: 'http://127.0.0.1:4848' })
    expect((next.hooks as typeof hooks).PreToolUse).toHaveLength(2)
    expect(stripSettingsGuard(next)).toEqual({ model: 'opus', hooks: { PreToolUse: [userHook] } })
    expect(editedKeys(next, { model: 'opus', hooks: { PreToolUse: [userHook] } })).toEqual([])
    expect(editedKeys({ ...next, model: 'sonnet' }, next)).toEqual(['model'])
  })

  it('removes only its hook on uninstall, repeatedly, without losing user settings', () => {
    shareConfig(global, folder)
    removeSettingsGuard(folder)
    removeSettingsGuard(folder)
    expect(read()).toEqual({ hooks: { PreToolUse: [userHook] } })
  })

  it('does not report an empty user hook list as an edit after adding its guard', () => {
    const settings = { hooks: { PreToolUse: [] } }
    expect(editedKeys(withSettingsGuard(settings, config()), settings)).toEqual([])
    expect(editedKeys(stripSettingsGuard(withSettingsGuard(settings, config())), settings)).toEqual([])
  })

  it('uninstalls across managed folders and preserves broken and global files', () => {
    shareConfig(global, folder)
    const broken = join(root, 'broken')
    mkdirSync(broken)
    writeFileSync(join(broken, 'settings.json'), '{broken')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      removeAccountSettingsGuards(root, global.dir)
      expect(read()).toEqual({ hooks: { PreToolUse: [userHook] } })
      expect(readFileSync(join(broken, 'settings.json'), 'utf8')).toBe('{broken')
      expect(warn).toHaveBeenCalledOnce()
    } finally { warn.mockRestore() }
  })

  it('protects a folder with no global settings, but does not overwrite broken folder JSON', () => {
    rmSync(join(global.dir, 'settings.json'))
    writeFileSync(join(folder, 'settings.json'), JSON.stringify({ model: 'sonnet' }))
    shareConfig(global, folder)
    expect(read().hooks.PreToolUse).toHaveLength(1)
    expect(read().model).toBe('sonnet')
    writeFileSync(join(folder, 'settings.json'), '{broken')
    shareConfig(global, folder)
    expect(readFileSync(join(folder, 'settings.json'), 'utf8')).toBe('{broken')
  })

  it('does not install into the global folder', () => {
    shareConfig(global, global.dir)
    expect(JSON.parse(readFileSync(join(global.dir, 'settings.json'), 'utf8')).hooks.PreToolUse).toEqual([userHook])
  })

  it('allows other files without asking the service, and allows missing input', async () => {
    const ask = vi.fn()
    for (const input of [{}, { tool_name: 'Edit', tool_input: { file_path: join(folder, 'other.ts') } },
      { tool_name: 'Write', tool_input: { file_path: join(global.dir, 'settings.json') } }]) {
      expect(await guardSettingsEdit(input, config(), ask)).toBeNull()
    }
    expect(ask).not.toHaveBeenCalled()
  })

  it('denies any managed Claude account, including relative and MultiEdit paths', async () => {
    const ask = vi.fn().mockResolvedValue({ account: { accounts: [
      { key: 'example', agent: 'claude', global: false },
      { key: 'codex', agent: 'codex', global: false },
    ] } })
    for (const input of [
      { tool_name: 'Edit', tool_input: { file_path: join(folder, 'settings.json') } },
      { tool_name: 'Write', cwd: folder, tool_input: { file_path: './settings.json' } },
      { tool_name: 'MultiEdit', tool_input: { edits: [{ file_path: join(folder, 'settings.json') }] } },
    ]) expect(await guardSettingsEdit(input, config(), ask)).toContain('~/.claude/settings.json')
    expect(await guardSettingsEdit({ tool_name: 'Edit', tool_input: { file_path: join(root, 'codex', 'settings.json') } }, config(), ask)).toBeNull()
  })

  it('matches Windows spellings and allows service errors or incomplete answers', async () => {
    const input = { tool_name: 'Edit', tool_input: { file_path: 'd:/ACCOUNTS/example/SETTINGS.json' } }
    const cfg = { accountsDir: 'D:\\accounts', globalDir: 'D:\\global', url: 'http://localhost:4747' }
    const state = { account: { accounts: [{ key: 'example', agent: 'claude', global: false }] } }
    expect(await guardSettingsEdit(input, cfg, async () => state, 'win32')).toContain('Accounts')
    expect(await guardSettingsEdit(input, cfg, async () => { throw new Error('offline') }, 'win32')).toBeNull()
    expect(await guardSettingsEdit(input, cfg, async () => ({}), 'win32')).toBeNull()
  })
})
