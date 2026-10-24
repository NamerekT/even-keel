import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { samePath } from '../paths.js'
import { linkedStore, linkType, mergeSettings, shareConfig, sharedMemory, shareProjects, skillStore } from './share.js'

describe('sharedMemory', () => {
  it('is the folder of the repository in the memory store next to the global folder, the one both folders link to', () => {
    expect(sharedMemory('C:/Users/john/.claude', 'C:/repos/example.app')).toBe(join('C:/Users/john', '.claude-memory', 'C--repos-example-app'))
  })
})

describe('linkType', () => {
  it('links folders by junction on Windows and by a plain symbolic link elsewhere', () => {
    expect(linkType('win32')).toBe('junction')
    expect(linkType('linux')).toBe('dir')
    expect(linkType('darwin')).toBe('dir')
  })
})

describe('shareConfig', () => {
  let root: string
  let global: { dir: string; config: string }
  let folder: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'even-keel-share-'))
    global = { dir: join(root, 'global'), config: join(root, '.claude.json') }
    folder = join(root, 'account')
    mkdirSync(join(global.dir, 'skills', 'review'), { recursive: true })
    writeFileSync(join(global.dir, 'settings.json'), JSON.stringify({ model: 'opus' }))
    writeFileSync(join(global.dir, 'CLAUDE.md'), '# Rules')
    writeFileSync(global.config, JSON.stringify({ projects: { 'C:/repos/example': { hasTrustDialogAccepted: true } } }))
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('reports a change on the first share and none on a repeat', () => {
    expect(shareConfig(global, folder)).toBe(true)
    expect(shareConfig(global, folder)).toBe(false)
  })

  it.each([
    ['settings', () => writeFileSync(join(global.dir, 'settings.json'), JSON.stringify({ model: 'sonnet' }))],
    ['CLAUDE.md', () => writeFileSync(join(global.dir, 'CLAUDE.md'), '# Rules, updated')],
    ['a project MCP server', () => writeFileSync(global.config, JSON.stringify({ projects: { 'C:/repos/example': { hasTrustDialogAccepted: true, mcpServers: { huly: {} } } } }))],
    ['a new skill', () => mkdirSync(join(global.dir, 'skills', 'deploy'))],
    ['a new linked folder', () => mkdirSync(join(global.dir, 'agents'))],
  ])('reports a change after the global %s changed', (_, change) => {
    shareConfig(global, folder)
    change()
    expect(shareConfig(global, folder)).toBe(true)
  })
})

describe('shareConfig project memory', () => {
  let root: string
  let global: { dir: string; config: string }
  let folder: string
  const warnings: string[] = []
  const memory = (dir: string, project = 'p1') => join(dir, 'projects', project, 'memory')
  const note = (dir: string, name: string, text: string, project = 'p1') => {
    mkdirSync(memory(dir, project), { recursive: true })
    writeFileSync(join(memory(dir, project), name), text)
  }

  beforeEach(() => {
    warnings.length = 0
    root = mkdtempSync(join(tmpdir(), 'even-keel-share-'))
    global = { dir: join(root, 'global'), config: join(root, '.claude.json') }
    folder = join(root, 'account')
    mkdirSync(global.dir, { recursive: true })
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const share = () => shareConfig(global, folder, (message) => warnings.push(message))
  const stored = (project = 'p1') => join(root, '.claude-memory', project)
  const linksTo = (path: string, target: string) => lstatSync(path).isSymbolicLink() && samePath(realpathSync(path), realpathSync(target))

  it('moves the global memory into the store and links the global folder to it', () => {
    note(global.dir, 'a.md', 'A')
    expect(share()).toBe(true)
    expect(readFileSync(join(stored(), 'a.md'), 'utf8')).toBe('A')
    expect(linksTo(memory(global.dir), stored())).toBe(true)
    expect(linksTo(memory(folder), stored())).toBe(true)
  })

  it('moves memory begun in the account into the store when it has none', () => {
    note(folder, 'a.md', 'A')
    expect(share()).toBe(true)
    expect(readFileSync(join(stored(), 'a.md'), 'utf8')).toBe('A')
    expect(linksTo(memory(folder), stored())).toBe(true)
    expect(readFileSync(join(memory(folder), 'a.md'), 'utf8')).toBe('A')
  })

  it('treats an empty global memory folder as none', () => {
    mkdirSync(memory(global.dir), { recursive: true })
    note(folder, 'a.md', 'A')
    share()
    expect(readFileSync(join(memory(global.dir), 'a.md'), 'utf8')).toBe('A')
    expect(linksTo(memory(folder), stored())).toBe(true)
  })

  it('brings over only the files the store lacks and links when nothing of its own is left', () => {
    note(global.dir, 'a.md', 'A')
    note(folder, 'a.md', 'A')
    note(folder, 'b.md', 'B')
    share()
    expect(readFileSync(join(stored(), 'b.md'), 'utf8')).toBe('B')
    expect(linksTo(memory(folder), stored())).toBe(true)
    expect(warnings).toEqual([])
  })

  it('leaves files that differ by content alone, warns and keeps the folder; the global memory wins', () => {
    note(global.dir, 'a.md', 'global')
    note(folder, 'a.md', 'account')
    note(folder, 'b.md', 'B')
    share()
    expect(readFileSync(join(stored(), 'a.md'), 'utf8')).toBe('global')
    expect(readFileSync(join(memory(folder), 'a.md'), 'utf8')).toBe('account')
    expect(readFileSync(join(stored(), 'b.md'), 'utf8')).toBe('B')
    expect(lstatSync(memory(folder)).isSymbolicLink()).toBe(false)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('a.md')
  })

  it('points an account link into the global folder at the store instead', () => {
    note(global.dir, 'a.md', 'A')
    mkdirSync(join(folder, 'projects', 'p1'), { recursive: true })
    symlinkSync(memory(global.dir), memory(folder), linkType(process.platform))
    expect(share()).toBe(true)
    expect(linksTo(memory(folder), stored())).toBe(true)
    expect(readlinkSync(memory(folder))).not.toContain('global')
    expect(readFileSync(join(memory(folder), 'a.md'), 'utf8')).toBe('A')
  })

  it('replaces a link whose target is gone', () => {
    note(global.dir, 'a.md', 'A')
    mkdirSync(join(folder, 'projects', 'p1'), { recursive: true })
    symlinkSync(join(root, 'gone'), memory(folder), linkType(process.platform))
    share()
    expect(linksTo(memory(folder), stored())).toBe(true)
  })

  it('reports a change on the move and none on a repeat', () => {
    note(folder, 'a.md', 'A')
    expect(share()).toBe(true)
    expect(share()).toBe(false)
  })

  it('moves nested folders of the memory too', () => {
    mkdirSync(join(memory(folder), 'sub'), { recursive: true })
    writeFileSync(join(memory(folder), 'sub', 'x.md'), 'X')
    share()
    expect(readFileSync(join(stored(), 'sub', 'x.md'), 'utf8')).toBe('X')
    expect(linksTo(memory(folder), stored())).toBe(true)
  })
})

describe('shareConfig skills', () => {
  let root: string
  let global: { dir: string; config: string }
  let folder: string
  const warnings: string[] = []
  const skill = (dir: string, name = 'review') => join(dir, 'skills', name)
  const stored = (name = 'review') => join(root, '.claude-skills', name)
  const linksTo = (path: string, target: string) => lstatSync(path).isSymbolicLink() && samePath(realpathSync(path), realpathSync(target))
  const share = () => shareConfig(global, folder, (message) => warnings.push(message))

  beforeEach(() => {
    warnings.length = 0
    root = mkdtempSync(join(tmpdir(), 'even-keel-share-'))
    global = { dir: join(root, 'global'), config: join(root, '.claude.json') }
    folder = join(root, 'account')
    mkdirSync(skill(global.dir), { recursive: true })
    writeFileSync(join(skill(global.dir), 'SKILL.md'), '# Review')
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('is a folder next to the global one', () => {
    expect(skillStore('C:/Users/john/.claude')).toBe(join('C:/Users/john', '.claude-skills'))
  })

  it('moves a global skill into the store and links both the global and the account folder to it', () => {
    expect(share()).toBe(true)
    expect(readFileSync(join(stored(), 'SKILL.md'), 'utf8')).toBe('# Review')
    expect(linksTo(skill(global.dir), stored())).toBe(true)
    expect(linksTo(skill(folder), stored())).toBe(true)
    expect(readlinkSync(skill(folder))).not.toContain('global')
  })

  it('reports a change on the move and none on a repeat', () => {
    expect(share()).toBe(true)
    expect(share()).toBe(false)
  })

  it('points an account link into the global folder at the store instead', () => {
    mkdirSync(join(folder, 'skills'), { recursive: true })
    symlinkSync(skill(global.dir), skill(folder), linkType(process.platform))
    expect(share()).toBe(true)
    expect(linksTo(skill(folder), stored())).toBe(true)
    expect(readFileSync(join(skill(folder), 'SKILL.md'), 'utf8')).toBe('# Review')
  })

  it('leaves the folders of the CLI itself in place', () => {
    mkdirSync(skill(global.dir, 'synced'), { recursive: true })
    mkdirSync(skill(global.dir, '.trash'), { recursive: true })
    share()
    expect(lstatSync(skill(global.dir, 'synced')).isSymbolicLink()).toBe(false)
    expect(lstatSync(skill(global.dir, '.trash')).isSymbolicLink()).toBe(false)
    expect(() => lstatSync(stored('synced'))).toThrow()
  })

  it('leaves a global skill that links elsewhere where it points, and the account links to it as before', () => {
    const elsewhere = join(root, 'repo', 'skills', 'strata')
    mkdirSync(elsewhere, { recursive: true })
    symlinkSync(elsewhere, skill(global.dir, 'strata'), linkType(process.platform))
    share()
    expect(linksTo(skill(global.dir, 'strata'), elsewhere)).toBe(true)
    expect(() => lstatSync(stored('strata'))).toThrow()
    expect(linksTo(skill(folder, 'strata'), elsewhere)).toBe(true)
  })

  it('leaves an account skill that links elsewhere alone', () => {
    const elsewhere = join(root, 'repo', 'skills', 'review')
    mkdirSync(elsewhere, { recursive: true })
    mkdirSync(join(folder, 'skills'), { recursive: true })
    symlinkSync(elsewhere, skill(folder), linkType(process.platform))
    share()
    expect(linksTo(skill(folder), elsewhere)).toBe(true)
  })

  it('merges into a store folder that already has the skill and warns about files that differ', () => {
    mkdirSync(stored(), { recursive: true })
    writeFileSync(join(stored(), 'SKILL.md'), '# Review, stored')
    writeFileSync(join(skill(global.dir), 'notes.md'), 'N')
    share()
    expect(readFileSync(join(stored(), 'notes.md'), 'utf8')).toBe('N')
    expect(readFileSync(join(stored(), 'SKILL.md'), 'utf8')).toBe('# Review, stored')
    expect(lstatSync(skill(global.dir)).isSymbolicLink()).toBe(false)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('SKILL.md')
    expect(linksTo(skill(folder), skill(global.dir))).toBe(true)
  })
})

describe('shareConfig linked folders', () => {
  let root: string
  let global: { dir: string; config: string }
  let folder: string
  const warnings: string[] = []
  const stored = (name = 'hooks') => join(root, `.claude-${name}`)
  const linksTo = (path: string, target: string) => lstatSync(path).isSymbolicLink() && samePath(realpathSync(path), realpathSync(target))
  const share = () => shareConfig(global, folder, (message) => warnings.push(message))

  beforeEach(() => {
    warnings.length = 0
    root = mkdtempSync(join(tmpdir(), 'even-keel-share-'))
    global = { dir: join(root, 'global'), config: join(root, '.claude.json') }
    folder = join(root, 'account')
    mkdirSync(join(global.dir, 'hooks'), { recursive: true })
    writeFileSync(join(global.dir, 'hooks', 'guard.mjs'), '// guard')
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('is a folder next to the global one, one per linked folder', () => {
    expect(linkedStore('C:/Users/john/.claude', 'hooks')).toBe(join('C:/Users/john', '.claude-hooks'))
    expect(linkedStore('C:/Users/john/.claude', 'output-styles')).toBe(join('C:/Users/john', '.claude-output-styles'))
  })

  it.each(['agents', 'commands', 'hooks', 'output-styles'])('moves the global %s into its store and links both folders to it', (name) => {
    mkdirSync(join(global.dir, name), { recursive: true })
    writeFileSync(join(global.dir, name, 'probe.md'), 'P')
    expect(share()).toBe(true)
    expect(readFileSync(join(stored(name), 'probe.md'), 'utf8')).toBe('P')
    expect(linksTo(join(global.dir, name), stored(name))).toBe(true)
    expect(linksTo(join(folder, name), stored(name))).toBe(true)
    expect(readlinkSync(join(folder, name))).not.toContain('global')
  })

  it('keeps a path through the global folder working, as the hook commands in settings.json use it', () => {
    share()
    expect(readFileSync(join(global.dir, 'hooks', 'guard.mjs'), 'utf8')).toBe('// guard')
  })

  it('reports a change on the move and none on a repeat', () => {
    expect(share()).toBe(true)
    expect(share()).toBe(false)
  })

  it('points an account link into the global folder at the store instead', () => {
    mkdirSync(folder, { recursive: true })
    symlinkSync(join(global.dir, 'hooks'), join(folder, 'hooks'), linkType(process.platform))
    expect(share()).toBe(true)
    expect(linksTo(join(folder, 'hooks'), stored())).toBe(true)
    expect(readFileSync(join(folder, 'hooks', 'guard.mjs'), 'utf8')).toBe('// guard')
  })

  it('links the global folder back to the store when its link is missing', () => {
    share()
    unlinkSync(join(global.dir, 'hooks'))
    expect(share()).toBe(true)
    expect(linksTo(join(global.dir, 'hooks'), stored())).toBe(true)
  })

  it('leaves a global folder that links elsewhere where it points, and the account links to it', () => {
    const elsewhere = join(root, 'repo', 'agents')
    mkdirSync(elsewhere, { recursive: true })
    symlinkSync(elsewhere, join(global.dir, 'agents'), linkType(process.platform))
    share()
    expect(linksTo(join(global.dir, 'agents'), elsewhere)).toBe(true)
    expect(() => lstatSync(stored('agents'))).toThrow()
    expect(linksTo(join(folder, 'agents'), elsewhere)).toBe(true)
  })

  it('merges into a store that already holds the folder and warns about files that differ', () => {
    mkdirSync(stored(), { recursive: true })
    writeFileSync(join(stored(), 'guard.mjs'), '// guard, stored')
    writeFileSync(join(global.dir, 'hooks', 'notify.mjs'), '// notify')
    share()
    expect(readFileSync(join(stored(), 'notify.mjs'), 'utf8')).toBe('// notify')
    expect(readFileSync(join(stored(), 'guard.mjs'), 'utf8')).toBe('// guard, stored')
    expect(lstatSync(join(global.dir, 'hooks')).isSymbolicLink()).toBe(false)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/^hooks: .*guard\.mjs/)
    expect(linksTo(join(folder, 'hooks'), join(global.dir, 'hooks'))).toBe(true)
  })
})

describe('mergeSettings', () => {
  it('lays the global settings over the folder ones and keeps what the CLI added there', () => {
    const global = { model: 'opus', remoteControlAtStartup: true, hooks: { PreToolUse: [] } }
    const folder = { model: 'sonnet', agentPushNotifEnabled: true }
    expect(mergeSettings(global, folder)).toEqual({ model: 'opus', agentPushNotifEnabled: true, remoteControlAtStartup: true, hooks: { PreToolUse: [] } })
  })

  it('starts from the global settings in a fresh folder', () => {
    expect(mergeSettings({ model: 'opus' }, undefined)).toEqual({ model: 'opus' })
  })

  it("keeps the API key of an API account folder under the global env and its key helper over the global one", () => {
    const global = { env: { HULY_TOKEN: 'fake-token', ANTHROPIC_API_KEY: 'sk-ant-global' }, apiKeyHelper: 'global-helper' }
    const folder = { env: { ANTHROPIC_API_KEY: 'sk-ant-fake', OLD: '1' }, apiKeyHelper: 'folder-helper' }
    expect(mergeSettings(global, folder)).toEqual({
      env: { HULY_TOKEN: 'fake-token', ANTHROPIC_API_KEY: 'sk-ant-fake' },
      apiKeyHelper: 'folder-helper',
    })
  })

  it('adds no env to a folder with a key helper of its own when the global settings have none', () => {
    expect(mergeSettings({ model: 'opus' }, { apiKeyHelper: 'folder-helper' })).toEqual({ model: 'opus', apiKeyHelper: 'folder-helper' })
  })
})

describe('shareProjects', () => {
  const global = {
    numStartups: 40,
    mcpServers: { search: { type: 'stdio', command: 'search-mcp' } },
    projects: {
      'C:/repos/example': {
        hasTrustDialogAccepted: true,
        mcpServers: { huly: { type: 'stdio', command: 'huly-mcp' } },
        allowedTools: ['Bash(npm test)'],
        enabledMcpjsonServers: [],
        lastCost: 12.5,
        lastSessionId: '00000000-0000-4000-8000-000000000001',
      },
      'C:/repos/untrusted': { hasTrustDialogAccepted: false, mcpServers: { huly: { type: 'stdio', command: 'huly-mcp' } } },
    },
  }

  it('brings over trust and project setup of trusted projects only, not their stats', () => {
    const folder = { numStartups: 2, projects: { 'C:/repos/example': { lastCost: 0.5, hasTrustDialogAccepted: false } } }
    expect(shareProjects(global, folder)).toEqual({
      numStartups: 2,
      mcpServers: { search: { type: 'stdio', command: 'search-mcp' } },
      projects: {
        'C:/repos/example': {
          lastCost: 0.5,
          hasTrustDialogAccepted: true,
          mcpServers: { huly: { type: 'stdio', command: 'huly-mcp' } },
          allowedTools: ['Bash(npm test)'],
          enabledMcpjsonServers: [],
        },
      },
    })
  })

  it('brings over the setup of a path spelled in another case or with backslashes when one spelling is trusted', () => {
    const huly = { huly: { type: 'stdio', command: 'huly-mcp' } }
    const spelled = {
      projects: {
        'C:/repos/example': { hasTrustDialogAccepted: true, mcpServers: huly },
        'c:/repos/example': { hasTrustDialogAccepted: false, mcpServers: huly, disabledMcpServers: ['forgejo'] },
        'c:\\repos\\example': { mcpServers: huly },
        'c:/repos/untrusted': { hasTrustDialogAccepted: false, mcpServers: huly },
      },
    }
    expect(shareProjects(spelled, {}, 'win32')?.projects).toEqual({
      'C:/repos/example': { hasTrustDialogAccepted: true, mcpServers: huly },
      'c:/repos/example': { hasTrustDialogAccepted: false, mcpServers: huly, disabledMcpServers: ['forgejo'] },
      'c:\\repos\\example': { mcpServers: huly },
    })
  })

  it('takes paths that differ in case for different projects on Linux', () => {
    const huly = { huly: { type: 'stdio', command: 'huly-mcp' } }
    const spelled = {
      projects: {
        '/home/john/Example': { hasTrustDialogAccepted: true, mcpServers: huly },
        '/home/john/example': { hasTrustDialogAccepted: false, mcpServers: huly },
      },
    }
    expect(shareProjects(spelled, {}, 'linux')?.projects).toEqual({ '/home/john/Example': { hasTrustDialogAccepted: true, mcpServers: huly } })
  })

  it('reports nothing to write when the folder already has it all', () => {
    const shared = shareProjects(global, {})!
    expect(shareProjects(global, shared)).toBeUndefined()
  })

  it('keeps projects the folder trusted by itself', () => {
    const folder = { projects: { 'C:/repos/own': { hasTrustDialogAccepted: true } } }
    expect(shareProjects(global, folder)?.projects).toHaveProperty(['C:/repos/own', 'hasTrustDialogAccepted'], true)
  })

  it('marks the first run as done when the global config has done it', () => {
    const onboarded = { ...global, hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.227' }
    expect(shareProjects(onboarded, {})).toMatchObject({ hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.227' })
  })

  it('keeps the first run the folder went through by itself', () => {
    const onboarded = { ...global, hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.227' }
    const folder = { ...shareProjects(global, {}), hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.287' }
    expect(shareProjects(onboarded, folder)).toBeUndefined()
  })
})
