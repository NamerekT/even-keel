import { describe, expect, it } from 'vitest'
import { mergeSettings, shareProjects } from './share.js'

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
})
