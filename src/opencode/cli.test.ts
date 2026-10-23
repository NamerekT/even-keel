import { describe, expect, it } from 'vitest'
import type { AgentEntry } from '../sessions/agents.js'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  hungEntry,
  parseJsonc,
  parseModels,
  parseWriteAnswer,
  pluginFiles,
  sessionConfig,
  sessionOf,
  turnArgs,
  turnEnded,
  turnError,
  TURN_HANG_MS,
  writeArgs,
  writeConfig,
} from './cli.js'

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
    expect(config.plugin).toBeUndefined()
  })

  it("loads the plugin packages' OpenCode plugins", () => {
    const config = JSON.parse(sessionConfig({}, [], [], ['file:///packages/checkpoint/opencode/checkpoint.mjs']))
    expect(config.plugin).toEqual(['file:///packages/checkpoint/opencode/checkpoint.mjs'])
  })
})

describe('pluginFiles', () => {
  it("takes the scripts of a package's opencode folder as file URLs, and nothing of a package without one", () => {
    const root = mkdtempSync(join(tmpdir(), 'ek-opencode-'))
    try {
      const checkpoint = join(root, 'checkpoint')
      mkdirSync(join(checkpoint, 'opencode'), { recursive: true })
      for (const file of ['checkpoint.mjs', 'notes.md', 'old.js']) writeFileSync(join(checkpoint, 'opencode', file), '')
      mkdirSync(join(root, 'huly'))
      const plugin = (dir: string, name: string) => ({ dir, name, marketplace: `ek-${name}`, marketplaceFile: '', servers: [] })
      expect(pluginFiles({ plugins: [plugin(checkpoint, 'checkpoint'), plugin(join(root, 'huly'), 'huly')] })).toEqual([
        pathToFileURL(join(checkpoint, 'opencode', 'checkpoint.mjs')).href,
        pathToFileURL(join(checkpoint, 'opencode', 'old.js')).href,
      ])
      expect(pluginFiles({})).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('a turn of its own', () => {
  const event = (value: Record<string, unknown>) => JSON.stringify({ timestamp: 1, sessionID: 'ses_abc', ...value })
  const finish = (tokens: Record<string, unknown>, cost: number) => event({ type: 'step_finish', part: { type: 'step-finish', reason: 'stop', tokens, cost } })

  it('runs with no external plugin, the prompt on stdin and the model when one is asked for', () => {
    expect(writeArgs(null)).toEqual(['run', '--pure', '--format', 'json', '--title', 'Even Keel'])
    expect(writeArgs('openai/gpt-6.1-sol')).toEqual(['run', '--pure', '--format', 'json', '--title', 'Even Keel', '-m', 'openai/gpt-6.1-sol'])
  })

  it("only reads: every other tool is denied, and the project's own servers are off", () => {
    const config = JSON.parse(writeConfig(['local-db']))
    for (const tool of ['edit', 'bash', 'webfetch', 'websearch', 'task', 'todowrite', 'skill', 'external_directory']) expect(config.permission[tool]).toBe('deny')
    expect(config.mcp).toEqual({ 'local-db': { enabled: false } })
  })

  it("answers with the last step's text and every step's tokens and cost", () => {
    const stdout = [
      event({ type: 'step_start' }),
      event({ type: 'text', part: { type: 'text', text: 'Let me look.' } }),
      event({ type: 'tool_use', part: { type: 'tool', tool: 'read' } }),
      event({ type: 'step_finish', part: { type: 'step-finish', reason: 'tool-calls', tokens: { input: 100, output: 10, reasoning: 5, cache: { read: 1000, write: 50 } }, cost: 0.01 } }),
      event({ type: 'step_start' }),
      event({ type: 'text', part: { type: 'text', text: '## Changes\n' } }),
      event({ type: 'text', part: { type: 'text', text: '- one\n' } }),
      finish({ input: 20, output: 30, reasoning: 0, cache: { read: 1200, write: 0 } }, 0.02),
    ].join('\n')
    const answer = parseWriteAnswer(stdout, 'opencode/big-pickle', 1500)
    expect(answer.text).toBe('## Changes\n\n- one')
    const { cost, ...spend } = answer.spend
    expect(spend).toEqual({ model: 'opencode/big-pickle', tokens: { input: 120, output: 45, cacheRead: 2200, cacheWrite: 50 }, durationMs: 1500 })
    expect(cost).toBeCloseTo(0.03)
  })

  it("throws with the provider's words on an error, and when the turn said nothing", () => {
    const failed = event({ type: 'error', error: { name: 'APIError', data: { message: 'Rate limit exceeded' } } })
    expect(() => parseWriteAnswer(failed, null, 0)).toThrow('Rate limit exceeded')
    expect(() => parseWriteAnswer(finish({ input: 1 }, 0), null, 0)).toThrow('the turn ended with no message')
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

  it("gives the error that ended the session's turn, with its time", () => {
    const error = { name: 'UnknownError', data: { message: 'Unexpected server error. Check server logs for details.' } }
    const failed = `${event({ type: 'step_start' })}\n${event({ type: 'error', timestamp: 1792776798957, error })}\n`
    expect(turnError(failed, 'ses_abc')).toEqual({ at: 1792776798957, error })
    expect(turnError(failed, 'ses_other')).toBeUndefined()
    expect(turnError(`${event({ type: 'step_finish', part: { reason: 'stop' } })}\n`, 'ses_abc')).toBeUndefined()
    expect(turnError('', 'ses_abc')).toBeUndefined()
  })
})

describe('opencode models', () => {
  it('lists the models one per line as `-m` takes them', () => {
    const stdout = 'opencode/big-pickle\r\nopencode/deepseek-v4.1-flash-free\n\nsome warning line\n'
    expect(parseModels(stdout)).toEqual(['opencode/big-pickle', 'opencode/deepseek-v4.1-flash-free'])
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
