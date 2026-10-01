import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mergeSettings, shareConfig, shareProjects } from './share.js'

describe('shareConfig', () => {
  let root: string
  let global: { dir: string; config: string }
  let folder: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'baton-share-'))
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
      'c:/repos/example': { mcpServers: { huly: { type: 'stdio', command: 'huly-mcp' } } },
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
