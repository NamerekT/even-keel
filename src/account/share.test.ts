import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { linkType, mergeSettings, shareConfig, shareProjects } from './share.js'

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

  it('moves memory begun in the account into the global folder when it has none', () => {
    note(folder, 'a.md', 'A')
    expect(share()).toBe(true)
    expect(readFileSync(join(memory(global.dir), 'a.md'), 'utf8')).toBe('A')
    expect(lstatSync(memory(folder)).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(memory(folder), 'a.md'), 'utf8')).toBe('A')
  })

  it('treats an empty global memory folder as none', () => {
    mkdirSync(memory(global.dir), { recursive: true })
    note(folder, 'a.md', 'A')
    share()
    expect(readFileSync(join(memory(global.dir), 'a.md'), 'utf8')).toBe('A')
    expect(lstatSync(memory(folder)).isSymbolicLink()).toBe(true)
  })

  it('brings over only the files the global folder lacks and links when nothing of its own is left', () => {
    note(global.dir, 'a.md', 'A')
    note(folder, 'a.md', 'A')
    note(folder, 'b.md', 'B')
    share()
    expect(readFileSync(join(memory(global.dir), 'b.md'), 'utf8')).toBe('B')
    expect(lstatSync(memory(folder)).isSymbolicLink()).toBe(true)
    expect(warnings).toEqual([])
  })

  it('leaves files that differ by content alone, warns and keeps the folder', () => {
    note(global.dir, 'a.md', 'global')
    note(folder, 'a.md', 'account')
    note(folder, 'b.md', 'B')
    share()
    expect(readFileSync(join(memory(global.dir), 'a.md'), 'utf8')).toBe('global')
    expect(readFileSync(join(memory(folder), 'a.md'), 'utf8')).toBe('account')
    expect(readFileSync(join(memory(global.dir), 'b.md'), 'utf8')).toBe('B')
    expect(lstatSync(memory(folder)).isSymbolicLink()).toBe(false)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('a.md')
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
    expect(readFileSync(join(memory(global.dir), 'sub', 'x.md'), 'utf8')).toBe('X')
    expect(lstatSync(memory(folder)).isSymbolicLink()).toBe(true)
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
