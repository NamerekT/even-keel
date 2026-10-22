import { describe, expect, it } from 'vitest'
import type { AgentEntry } from '../sessions/agents.js'
import { hungEntry, parseJsonc, sessionConfig, sessionOf, turnArgs, turnEnded, TURN_HANG_MS } from './cli.js'

describe('turnArgs', () => {
  it('titles a new session with its task and resumes one by its id', () => {
    expect(turnArgs({ name: 'DEMO-1', model: 'opencode/big-pickle' }, 'DEMO-1')).toEqual([
      'run',
      '--format',
      'json',
      '-m',
      'opencode/big-pickle',
      '--title',
      'DEMO-1',
      '--',
      'DEMO-1',
    ])
    expect(turnArgs({ name: 'DEMO-1', model: null }, 'go on', 'ses_abc')).toEqual(['run', '--format', 'json', '-s', 'ses_abc', '--', 'go on'])
  })

  it('keeps a prompt that starts with a dash, as a reply does, from being read as an option', () => {
    expect(turnArgs({ name: 'DEMO-1', model: null }, '- "Q" → yes', 'ses_abc').slice(-2)).toEqual(['--', '- "Q" → yes'])
  })
})

describe('sessionConfig', () => {
  const server = { name: 'huly', plugin: 'huly', url: 'http://127.0.0.1:4748/mcp/huly' }

  it("turns the project's own servers off and puts the gateway's in their place", () => {
    const config = JSON.parse(sessionConfig({ mcp: [server] }, ['local-db'], []))
    expect(config.permission).toEqual({ external_directory: 'allow' })
    expect(config.mcp).toEqual({
      'local-db': { enabled: false },
      plugin_huly_huly: { type: 'remote', url: server.url, enabled: true },
    })
    expect(config.skills).toBeUndefined()
  })

  it("leaves the servers alone without packages and hands the plugins' skills folders", () => {
    const config = JSON.parse(sessionConfig({}, ['local-db'], ['/packages/huly/skills']))
    expect(config.mcp).toBeUndefined()
    expect(config.skills).toEqual({ paths: ['/packages/huly/skills'] })
  })
})

describe('parseJsonc', () => {
  it('reads comments and trailing commas, keeping slashes inside strings', () => {
    const text = '{\n  // servers\n  "mcp": { "a": { "url": "http://example.com/x" }, /* b */ },\n}'
    expect(parseJsonc(text)).toEqual({ mcp: { a: { url: 'http://example.com/x' } } })
    expect(parseJsonc('[1]')).toBeUndefined()
    expect(parseJsonc('{')).toBeUndefined()
  })
})

describe('the output of opencode run', () => {
  const event = (value: Record<string, unknown>) => JSON.stringify({ timestamp: 1, sessionID: 'ses_abc', ...value })

  it('names the session from its first event', () => {
    expect(sessionOf(`not json\n${event({ type: 'step_start' })}\n`)).toBe('ses_abc')
    expect(sessionOf('')).toBeUndefined()
  })

  it('ends the turn on a step that did not stop for a tool, or on an error', () => {
    expect(turnEnded(`${event({ type: 'step_finish', part: { reason: 'tool-calls' } })}\n`)).toBe(false)
    expect(turnEnded(`${event({ type: 'step_finish', part: { reason: 'stop' } })}\n`)).toBe(true)
    expect(turnEnded(`${event({ type: 'error', error: { name: 'APIError' } })}\n`)).toBe(true)
    expect(turnEnded(`${event({ type: 'tool_use' })}\n`)).toBe(false)
  })
})

describe('a hung turn', () => {
  const busy: AgentEntry = { sessionId: 'ses_abc', kind: 'opencode', cwd: '/repo', startedAt: 0, pid: 42, status: 'busy', state: 'working' }
  const now = Date.parse('2026-10-22T12:00:00Z')

  it('keeps a turn busy while it wrote something within the threshold', () => {
    expect(hungEntry(busy, now - TURN_HANG_MS + 1, now)).toEqual(busy)
  })

  it('takes a live turn silent past the threshold for hung: idle, with its process kept to be stopped', () => {
    expect(hungEntry(busy, now - TURN_HANG_MS, now)).toEqual({ ...busy, status: 'idle', hungSince: now - TURN_HANG_MS })
  })

  it('leaves a session alone that has no live turn', () => {
    const resting: AgentEntry = { sessionId: 'ses_abc', kind: 'opencode', cwd: '/repo', startedAt: 0, status: 'idle', state: 'working', resting: true }
    expect(hungEntry(resting, 0, now)).toEqual(resting)
  })
})
