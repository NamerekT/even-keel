import { describe, expect, it } from 'vitest'
import type { AgentEntry } from '../sessions/agents.js'
import { resumeArgs, resumedAs, sessionArgs } from './cli.js'

describe('sessionArgs', () => {
  it('passes the chain settings with --settings only when there are any', () => {
    expect(sessionArgs('ABC-1', 'opus')).toEqual(['--bg', '--permission-mode', 'auto', '-n', 'ABC-1', '--model', 'opus'])
    expect(sessionArgs('ABC-1', 'opus', { settings: '{"syncClaudeAiSkills":false}' }).slice(-2)).toEqual(['--settings', '{"syncClaudeAiSkills":false}'])
  })

  it('passes the gateway servers first and strictly, plugin ones under the plugin, and a --plugin-dir per plugin', () => {
    const mcp = [
      { name: 'huly', plugin: 'huly', url: 'http://127.0.0.1:4748/mcp/p/huly%40even-keel@a/huly' },
      { name: 'strata', plugin: null, url: 'http://127.0.0.1:4748/mcp/p/strata@b/strata' },
    ]
    const plugins = [{ dir: 'C:\cache\huly', name: 'huly', marketplace: 'ek-a', marketplaceFile: 'C:\cache\.claude-plugin\marketplace.json', servers: ['huly'] }]
    const args = sessionArgs('ABC-1', null, { mcp, plugins })
    expect(args.slice(0, 4)).toEqual(['--bg', '--mcp-config', expect.any(String), '--strict-mcp-config'])
    expect(JSON.parse(args[2]!)).toEqual({
      mcpServers: { plugin_huly_huly: { type: 'http', url: mcp[0]!.url }, strata: { type: 'http', url: mcp[1]!.url } },
    })
    expect(args.slice(4, 6)).toEqual(['--plugin-dir', 'C:\cache\huly'])
    expect(sessionArgs('ABC-1', null, { mcp: [] }).slice(0, 4)).toEqual(['--bg', '--mcp-config', '{"mcpServers":{}}', '--strict-mcp-config'])
  })

  it('passes no --model without a chosen model, so the CLI takes its configured one', () => {
    expect(sessionArgs('ABC-1', null)).toEqual(['--bg', '--permission-mode', 'auto', '-n', 'ABC-1'])
  })
})

describe('resumeArgs', () => {
  it('passes no flags when the background session keeps its saved options, so it goes on under its own id', () => {
    expect(resumeArgs('s-1', 'answer', true, 'ABC-1', 'opus', { settings: '{}' })).toEqual(['--bg', '--resume', 's-1', 'answer'])
  })

  it('passes the session flags when there is no saved background session', () => {
    expect(resumeArgs('s-1', 'answer', false, 'ABC-1', 'opus')).toEqual([...sessionArgs('ABC-1', 'opus'), '--resume', 's-1', 'answer'])
  })
})

describe('resumedAs', () => {
  const since = Date.parse('2026-10-10T08:40:29Z')
  const agent = (fields: Partial<AgentEntry>): AgentEntry => ({
    id: 'job-old',
    cwd: '/repo/.claude/worktrees/ABC-1',
    kind: 'bg',
    startedAt: since + 1_000,
    sessionId: 'old',
    name: 'ABC-1',
    state: 'running',
    ...fields,
  })
  const match = resumedAs('job-old', 'old', 'ABC-1', '/repo/.claude/worktrees/ABC-1', since)

  it('finds the resumed session under its own id', () => {
    expect(match(agent({}))).toBe(true)
  })

  it('finds the copy the CLI started under a new id', () => {
    expect(match(agent({ id: 'job-new', sessionId: 'new' }))).toBe(true)
  })

  it('does not take the fresh id the respawned process of the same job shows before it loads the session', () => {
    expect(match(agent({ sessionId: 'fresh' }))).toBe(false)
  })

  it('does not take the stopped session that was resumed', () => {
    expect(match(agent({ state: 'stopped', startedAt: since - 3_600_000 }))).toBe(false)
  })

  it('does not take an earlier session of the task, another task or another folder', () => {
    expect(match(agent({ sessionId: 'earlier', startedAt: since - 3_600_000 }))).toBe(false)
    expect(match(agent({ sessionId: 'new', name: 'ABC-2' }))).toBe(false)
    expect(match(agent({ sessionId: 'new', cwd: '/repo' }))).toBe(false)
  })
})
