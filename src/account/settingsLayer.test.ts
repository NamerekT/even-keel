import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AccountHome } from './homes.js'
import { AccountSettings, editedKeys, planSettings, type SettingsRecord } from './settingsLayer.js'
import { shareConfig } from './share.js'
import { stripSettingsGuard } from './settingsGuard.js'

describe('editedKeys', () => {
  it('names the top-level keys whose value moved away from what the last transfer wrote, added and removed ones too', () => {
    const written = { model: 'opus', theme: 'dark', permissions: { allow: ['Read'] } }
    expect(editedKeys({ model: 'sonnet', permissions: { allow: ['Read'] }, effortLevel: 'high' }, written)).toEqual(['effortLevel', 'model', 'theme'])
    expect(editedKeys({ ...written }, written)).toEqual([])
  })

  it('leaves out what the folder owns anyway and what the CLI writes by itself', () => {
    const written = { env: { ANTHROPIC_API_KEY: 'sk-ant-old', TOKEN: 'a' }, apiKeyHelper: 'old' }
    expect(editedKeys({ env: { ANTHROPIC_API_KEY: 'sk-ant-new', TOKEN: 'a' }, apiKeyHelper: 'new', autoUpdatesChannel: 'stable', minimumVersion: '2.1.0' }, written)).toEqual([])
    expect(editedKeys({ env: { ANTHROPIC_API_KEY: 'sk-ant-old', TOKEN: 'b' } }, written)).toEqual(['env'])
  })
})

describe('planSettings', () => {
  const global = { model: 'opus', theme: 'dark', env: { TOKEN: 'shared' } }

  it('is the plain transfer while nothing was written before, and remembers what it wrote', () => {
    const plan = planSettings(global, { model: 'sonnet', statusLine: 'own' }, undefined)
    expect(plan.file).toEqual({ model: 'opus', theme: 'dark', env: { TOKEN: 'shared' }, statusLine: 'own' })
    expect(plan.written).toEqual(plan.file)
    expect(plan.edits).toEqual([])
  })

  it('keeps a key changed in the folder since the last transfer and goes on remembering the old value', () => {
    const record: SettingsRecord = { written: { ...global }, own: {} }
    const plan = planSettings({ ...global, theme: 'light' }, { ...global, model: 'sonnet' }, record)
    expect(plan.file).toMatchObject({ model: 'sonnet', theme: 'light' })
    expect(plan.written).toMatchObject({ model: 'opus', theme: 'light' })
    expect(plan.edits).toEqual(['model'])
  })

  it('keeps a key removed in the folder removed', () => {
    const { theme: _, ...folder } = global
    const plan = planSettings(global, folder, { written: { ...global }, own: {} })
    expect('theme' in plan.file).toBe(false)
    expect(plan.written.theme).toBe('dark')
    expect(plan.edits).toEqual(['theme'])
  })

  it('transfers a discarded key as usual', () => {
    const plan = planSettings(global, { ...global, model: 'sonnet' }, { written: { ...global }, own: {} }, new Set(['model']))
    expect(plan.file.model).toBe('opus')
    expect(plan.edits).toEqual([])
  })

  it("puts the account's own layer on top of the global settings; null removes the key", () => {
    const plan = planSettings(global, { ...global }, { written: { ...global }, own: { model: 'haiku', theme: null } })
    expect(plan.file.model).toBe('haiku')
    expect('theme' in plan.file).toBe(false)
    expect(plan.written).toEqual(plan.file)
    expect(plan.edits).toEqual([])
  })

  it("keeps the folder's API key under an own env", () => {
    const folder = { env: { ANTHROPIC_API_KEY: 'sk-ant-example', TOKEN: 'shared' } }
    const plan = planSettings(global, folder, { written: { ...global, ...folder }, own: { env: { TOKEN: 'own' } } })
    expect(plan.file.env).toEqual({ TOKEN: 'own', ANTHROPIC_API_KEY: 'sk-ant-example' })
  })
})

describe('AccountSettings', () => {
  let root: string
  let globalDir: string
  let home: AccountHome
  let saved: Map<string, SettingsRecord | null>
  let settings: AccountSettings
  const read = (dir: string) => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as Record<string, unknown>
  const write = (dir: string, value: unknown) => writeFileSync(join(dir, 'settings.json'), JSON.stringify(value))
  const share = () => shareConfig({ dir: globalDir, config: join(root, '.claude.json') }, home.dir, () => {}, settings.planner(home.key))

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'even-keel-layer-'))
    globalDir = join(root, 'global')
    home = { key: 'example', dir: join(root, 'example'), global: false, agent: 'claude' }
    mkdirSync(globalDir, { recursive: true })
    mkdirSync(home.dir, { recursive: true })
    write(globalDir, { model: 'opus', theme: 'dark' })
    saved = new Map()
    settings = new AccountSettings(new Map(), globalDir, (account, record) => saved.set(account, record))
    share()
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('remembers what the first transfer wrote and sees an edit in the folder before the next launch', () => {
    expect(saved.get('example')?.written).toEqual({ model: 'opus', theme: 'dark' })
    expect(settings.edits(home)).toEqual([])
    write(home.dir, { model: 'sonnet', theme: 'dark' })
    expect(settings.edits(home)).toEqual(['model'])
    share()
    expect(read(home.dir).model).toBe('sonnet')
    expect(settings.edits(home)).toEqual(['model'])
  })

  it('"make shared" moves the value into the global settings', () => {
    write(home.dir, { model: 'sonnet', theme: 'dark', env: { ANTHROPIC_API_KEY: 'sk-ant-example', TOKEN: 'a' } })
    settings.resolve(home, 'model', 'share')
    settings.resolve(home, 'env', 'share')
    share()
    expect(read(globalDir)).toEqual({ model: 'sonnet', theme: 'dark', env: { TOKEN: 'a' } })
    expect(settings.edits(home)).toEqual([])
  })

  it('"keep for this account" puts the value into its own layer, which outlives the next transfers', () => {
    write(home.dir, { model: 'sonnet', theme: 'dark' })
    settings.resolve(home, 'model', 'own')
    share()
    write(globalDir, { model: 'fable', theme: 'light' })
    share()
    expect(stripSettingsGuard(read(home.dir))).toEqual({ model: 'sonnet', theme: 'light' })
    expect(settings.own('example')).toEqual(['model'])
    expect(settings.edits(home)).toEqual([])
    settings.dropOwn(home, 'model')
    share()
    expect(read(home.dir).model).toBe('fable')
    expect(settings.own('example')).toEqual([])
  })

  it('"discard" lets the next transfer write the global value', () => {
    write(home.dir, { model: 'sonnet', theme: 'dark' })
    settings.resolve(home, 'model', 'discard')
    share()
    expect(read(home.dir).model).toBe('opus')
    expect(settings.edits(home)).toEqual([])
  })

  it('keeps the guard over own hooks, never shares it, and survives rebuilding the planner', () => {
    const hook = { matcher: 'Write', hooks: [{ type: 'command', command: 'echo user' }] }
    write(home.dir, { ...read(home.dir), hooks: { PreToolUse: [hook] } })
    settings.resolve(home, 'hooks', 'own')
    share()
    expect((read(home.dir).hooks as { PreToolUse: unknown[] }).PreToolUse).toHaveLength(2)
    expect(settings.edits(home)).toEqual([])
    const record = saved.get(home.key)!
    settings = new AccountSettings(new Map([[home.key, record!]]), globalDir, (account, value) => saved.set(account, value))
    share()
    expect(settings.edits(home)).toEqual([])
    settings.dropOwn(home, 'hooks')
    share()
    const current = read(home.dir).hooks as { PreToolUse: unknown[] }
    write(home.dir, { ...read(home.dir), hooks: { PreToolUse: [...current.PreToolUse, { matcher: 'Edit', hooks: [{ type: 'command', command: 'echo another' }] }] } })
    settings.resolve(home, 'hooks', 'share')
    expect(JSON.stringify(read(globalDir))).not.toContain('--even-keel-account-settings')
    share()
    expect(settings.edits(home)).toEqual([])
  })

  it('refuses to resolve a key that was not edited, and to drop an own key that is not there', () => {
    expect(() => settings.resolve(home, 'model', 'share')).toThrow(/model/)
    expect(() => settings.dropOwn(home, 'model')).toThrow(/model/)
  })

  it('forgets a removed account', () => {
    settings.forget('example')
    expect(saved.get('example')).toBeNull()
    write(home.dir, { env: { ANTHROPIC_API_KEY: 'sk-ant-example' } })
    expect(settings.edits(home)).toEqual([])
  })
})
