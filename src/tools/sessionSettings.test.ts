import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseConfig } from '../config.js'
import { formsOf, withProjectForm, withSharedForm } from '../config-form.js'
import { contextArgs, parseContextWindow } from '../claude/context.js'
import type { Git } from '../git/types.js'
import { runGit } from '../git/run.js'
import { withinWindow } from '../stats/checkpoint.js'
import { createChatSettings, createSessionSettings } from './sessionSettings.js'

const project = { id: 'p', key: 'ABC', repo: 'C:/example', tracker: 'huly' }
const raw = { projects: [project] }
const noGit: Git = async () => ({ code: 128, out: 'not a git repository' })

describe("the project's settings.json of a chain session", { timeout: 30_000 }, () => {
  it("is the branch's version, as the task worktree has it, not the main checkout's edits", async () => {
    const root = mkdtempSync(join(tmpdir(), 'session-settings-'))
    try {
      const git = async (...args: string[]) => {
        const result = await runGit(root, args)
        if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed (${result.code}): ${result.out}`)
      }
      await git('init', '-q', '-b', 'trunk')
      mkdirSync(join(root, '.claude'))
      writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'design@market': true } }))
      await git('add', '-A')
      await git('-c', 'user.name=John Doe', '-c', 'user.email=john@example.com', 'commit', '-qm', 'settings')
      writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'notes@market': true } }))
      const seen: unknown[][] = []
      const settingsFor = createSessionSettings({
        config: () => parseConfig({ projects: [{ ...project, repo: root }] }),
        packages: { otherPlugins: (_project, _task, files) => (seen.push(files), {}), keyNames: () => [], bringsServer: () => false },
        globalDir: join(root, 'home'), trim: () => true, projectOf: () => 'p', git: runGit, branchOf: () => 'trunk',
      })
      await settingsFor('ABC-1')
      expect(seen[0]?.[1]).toEqual({ enabledPlugins: { 'design@market': true } })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('the cache trial (BTN-1412)', () => {
  const ttlOf = async (config: unknown, task: string) => {
    const settingsFor = createSessionSettings({
      config: () => parseConfig(config),
      packages: { otherPlugins: () => ({}), keyNames: () => [], bringsServer: () => false },
      globalDir: 'C:/example-home', trim: () => false, projectOf: () => 'p', git: noGit, branchOf: () => 'main',
    })
    return (JSON.parse((await settingsFor(task))!) as Record<string, unknown>).promptCacheTtl
  }

  it("gives a numbered task its variant over the project's own lifetime while on", async () => {
    const config = { cacheTrial: true, cacheTtl: '1h', projects: [{ ...project, cacheTtl: null }] }
    expect(await Promise.all(['ABC-8', 'ABC-9', 'ABC-10', 'ABC-11'].map((task) => ttlOf(config, task)))).toEqual(['5m', '5m', '1h', '1h'])
  })

  it("leaves the project's lifetime off, and to a session named without a number", async () => {
    expect(await ttlOf({ cacheTtl: '1h', projects: [project] }, 'ABC-8')).toBe('1h')
    expect(await ttlOf({ cacheTrial: true, projects: [{ ...project, cacheTtl: '1h' }] }, 'ABC-FIX')).toBe('1h')
  })

  it('is off by default and refuses a non-boolean', () => {
    expect(parseConfig(raw).cacheTrial).toBe(false)
    expect(() => parseConfig({ ...raw, cacheTrial: 'yes' })).toThrow(/cacheTrial/)
  })
})

describe('chain auto-compaction window', () => {
  it('takes the project override, including null, before the shared value at each launch', async () => {
    let config = parseConfig({ ...raw, autoCompactWindow: 300_000 })
    const settingsFor = createSessionSettings({
      config: () => config,
      packages: { otherPlugins: () => ({}), keyNames: () => [], bringsServer: () => false },
      globalDir: 'C:/example-home', trim: () => false, projectOf: () => 'p', git: noGit, branchOf: () => 'main',
    })
    const settings = async () => JSON.parse((await settingsFor('ABC-1'))!)
    expect(await settings()).toHaveProperty('autoCompactWindow', 300_000)
    config = parseConfig({ autoCompactWindow: 300_000, projects: [{ ...project, autoCompactWindow: 400_000 }] })
    expect(await settings()).toHaveProperty('autoCompactWindow', 400_000)
    config = parseConfig({ autoCompactWindow: 300_000, projects: [{ ...project, autoCompactWindow: null }] })
    expect(await settings()).not.toHaveProperty('autoCompactWindow')
    config = parseConfig(raw)
    expect(await settings()).not.toHaveProperty('autoCompactWindow')
  })

  it('round trips shared, project, account and inherited values through the forms', () => {
    const forms = formsOf(parseConfig(raw))
    const shared = withSharedForm(raw, { ...forms.shared, autoCompactWindow: 300_000 }, forms.shared)
    expect(parseConfig(shared).autoCompactWindow).toBe(300_000)
    const base = formsOf(parseConfig(shared)).projects.p!
    const own = withProjectForm(shared, 'p', { ...base, own: { autoCompactWindow: 400_000 } }, base)
    expect(parseConfig(own).settings.p?.autoCompactWindow).toBe(400_000)
    const ownForm = formsOf(parseConfig(own)).projects.p!
    const account = withProjectForm(own, 'p', { ...ownForm, own: { autoCompactWindow: null } }, ownForm)
    expect(parseConfig(account).settings.p?.autoCompactWindow).toBeNull()
    const accountForm = formsOf(parseConfig(account)).projects.p!
    const inherited = withProjectForm(account, 'p', { ...accountForm, own: {} }, accountForm)
    expect(parseConfig(inherited).settings.p?.autoCompactWindow).toBe(300_000)
  })

  it.each([0, -1, 1.5, '300000', true, Infinity])('refuses an invalid window %s at either level', (autoCompactWindow) => {
    expect(() => parseConfig({ ...raw, autoCompactWindow })).toThrow(/autoCompactWindow/)
    expect(() => parseConfig({ projects: [{ ...project, autoCompactWindow }] })).toThrow(/autoCompactWindow/)
  })

  it('probes with the chain settings and moves all thresholds with the measured window', async () => {
    const settingsFor = createSessionSettings({
      config: () => parseConfig({ ...raw, autoCompactWindow: 300_000 }),
      packages: { otherPlugins: () => ({}), keyNames: () => [], bringsServer: () => false },
      globalDir: 'C:/example-home', trim: () => false, projectOf: () => 'p', git: noGit, branchOf: () => 'main',
    })
    const args = contextArgs('opus', await settingsFor('ABC-1'))
    expect(JSON.parse(args[args.indexOf('--settings') + 1]!)).toHaveProperty('autoCompactWindow', 300_000)
    const measured = (window: string) => parseContextWindow(JSON.stringify({ result: `**Tokens:** 1k / ${window} (1%)` }))
    const threshold = { first: 250_000, source: 'calibrated' as const }
    expect(withinWindow(threshold, measured('250k'), undefined, 'claude')).toMatchObject({ first: 180_000, late: 188_000, hard: 203_000 })
    expect(withinWindow(threshold, measured('300k'), undefined, 'claude')).toMatchObject({ first: 216_000, late: 238_000, hard: 253_000 })
  })
})

describe("a Claude project chat's --settings (BTN-1694)", () => {
  it("turns off the plugins of the user's and the folder's settings its set does not bring, on the hour-long cache, keys blanked, never trimmed", () => {
    const root = mkdtempSync(join(tmpdir(), 'chat-settings-'))
    try {
      mkdirSync(join(root, 'home'))
      mkdirSync(join(root, '.claude'))
      writeFileSync(join(root, 'home', 'settings.json'), JSON.stringify({ enabledPlugins: { 'own@market': true } }))
      writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'notes@market': true } }))
      writeFileSync(join(root, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { 'local@market': true } }))
      const seen: { task: string | null; files: unknown[] }[] = []
      const chatSettingsFor = createChatSettings({
        config: () => parseConfig({ cacheTtl: '5m', hiddenSkills: ['example-skill'], projects: [{ ...project, repo: root, cacheTtl: '5m' }] }),
        packages: {
          otherPlugins: (_project, task, files) => (seen.push({ task, files }), { 'own@market': false, 'notes@market': false }),
          keyNames: () => ['EXAMPLE_KEY'],
        },
        globalDir: join(root, 'home'),
      })
      const settings = JSON.parse(chatSettingsFor('p', root)) as Record<string, unknown>
      expect(seen).toEqual([{ task: null, files: [{ enabledPlugins: { 'own@market': true } }, { enabledPlugins: { 'notes@market': true } }, { enabledPlugins: { 'local@market': true } }] }])
      expect(settings).toMatchObject({ promptCacheTtl: '1h', enabledPlugins: { 'own@market': false, 'notes@market': false }, env: { EXAMPLE_KEY: '' } })
      expect(settings).toHaveProperty('permissions.deny')
      expect(settings).not.toHaveProperty('skillOverrides')
      expect(settings).not.toHaveProperty('autoCompactWindow')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
