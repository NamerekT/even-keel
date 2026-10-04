import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { McpCheck, mcpVisible, readMcpSources, type McpSources } from './mcp.js'

const REPO = 'D:\\repos\\abc'
const none: McpSources = { configs: [{}], repoServers: {}, plugins: [] }

describe('mcpVisible', () => {
  it('finds a user scope server', () => {
    expect(mcpVisible('huly', REPO, { ...none, configs: [{ mcpServers: { huly: {} } }] }, 'win32')).toBe(true)
  })

  it('finds a local scope server under any spelling of the repository path', () => {
    const configs = [{ projects: { 'd:/repos/abc': { mcpServers: { huly: {} } } } }]
    expect(mcpVisible('huly', REPO, { ...none, configs }, 'win32')).toBe(true)
    expect(mcpVisible('huly', 'D:\\repos\\other', { ...none, configs }, 'win32')).toBe(false)
  })

  it('finds a project scope server of .mcp.json unless the project disabled it', () => {
    expect(mcpVisible('huly', REPO, { ...none, repoServers: { huly: {} } }, 'win32')).toBe(true)
    const configs = [{ projects: { [REPO]: { disabledMcpjsonServers: ['huly'] } } }]
    expect(mcpVisible('huly', REPO, { configs, repoServers: { huly: {} }, plugins: [] }, 'win32')).toBe(false)
  })

  it('finds a server of an enabled plugin', () => {
    expect(mcpVisible('huly', REPO, { ...none, plugins: [{ name: 'tracker', servers: { huly: {} } }] }, 'win32')).toBe(true)
  })

  it('skips a server the project turned off', () => {
    const configs = [{ mcpServers: { huly: {} }, projects: { [REPO]: { disabledMcpServers: ['huly', 'plugin:tracker:huly'] } } }]
    const plugins = [{ name: 'tracker', servers: { huly: {} } }]
    expect(mcpVisible('huly', REPO, { configs, repoServers: {}, plugins }, 'win32')).toBe(false)
  })

  it('does not see a server nobody declares', () => {
    expect(mcpVisible('huly', REPO, { ...none, configs: [{ mcpServers: { forgejo: {} } }] }, 'win32')).toBe(false)
  })
})

describe('McpCheck', () => {
  const target = { project: 'ABC', repo: REPO, server: 'huly' }

  it('reports a missing server once and clears it when the server shows up', () => {
    let sources: McpSources | undefined = none
    const warnings: string[] = []
    let changes = 0
    const check = new McpCheck({ targets: () => [target], read: () => sources, warn: (line) => warnings.push(line), onChange: () => changes++ })
    check.run()
    check.run()
    expect(check.missing).toEqual([{ project: 'ABC', server: 'huly' }])
    expect(warnings).toHaveLength(1)
    sources = { ...none, repoServers: { huly: {} } }
    check.run()
    expect(check.missing).toEqual([])
    expect(changes).toBe(2)
  })

  it('only logs, once, when the CLI config cannot be read', () => {
    const warnings: string[] = []
    const check = new McpCheck({ targets: () => [target], read: () => undefined, warn: (line) => warnings.push(line), onChange: () => {} })
    check.run()
    check.run()
    expect(check.missing).toEqual([])
    expect(warnings).toEqual([expect.stringMatching(/ABC.*huly/)])
  })
})

describe('readMcpSources', () => {
  const root = mkdtempSync(join(tmpdir(), 'even-keel-mcp-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('reads enabled plugins from the settings of the user and the repository', () => {
    const claudeDir = join(root, 'claude')
    const repo = join(root, 'repo')
    const enabled = join(root, 'plugins', 'tracker')
    const disabled = join(root, 'plugins', 'other')
    mkdirSync(join(claudeDir, 'plugins'), { recursive: true })
    mkdirSync(join(repo, '.claude'), { recursive: true })
    mkdirSync(join(enabled, '.claude-plugin'), { recursive: true })
    mkdirSync(disabled, { recursive: true })
    writeFileSync(join(root, 'claude.json'), JSON.stringify({ mcpServers: {} }))
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ enabledPlugins: { 'tracker@market': false, 'other@market': true } }))
    writeFileSync(join(repo, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'tracker@market': true, 'other@market': false } }))
    writeFileSync(
      join(claudeDir, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ plugins: { 'tracker@market': [{ installPath: enabled }], 'other@market': [{ installPath: disabled }] } }),
    )
    writeFileSync(join(enabled, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'tracker', mcpServers: { huly: {} } }))
    writeFileSync(join(disabled, '.mcp.json'), JSON.stringify({ mcpServers: { other: {} } }))
    writeFileSync(join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { forgejo: {} } }))

    const sources = readMcpSources(repo, { claudeDir, configs: [join(root, 'claude.json')] })
    expect(sources?.plugins).toEqual([{ name: 'tracker', servers: { huly: {} } }])
    expect(sources?.repoServers).toEqual({ forgejo: {} })
  })

  it('gives up when the CLI config cannot be read', () => {
    expect(readMcpSources(root, { claudeDir: join(root, 'none'), configs: [join(root, 'none.json')] })).toBeUndefined()
  })
})
