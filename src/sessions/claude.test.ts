import { describe, expect, it } from 'vitest'
import type { AgentEntry } from './agents.js'
import { resumedAs, sessionArgs } from './claude.js'

describe('sessionArgs', () => {
  it('passes the chain settings with --settings only when there are any', () => {
    expect(sessionArgs('ABC-1', 'opus')).toEqual(['--bg', '--permission-mode', 'auto', '-n', 'ABC-1', '--model', 'opus'])
    expect(sessionArgs('ABC-1', 'opus', '{"syncClaudeAiSkills":false}').slice(-2)).toEqual(['--settings', '{"syncClaudeAiSkills":false}'])
  })
})

describe('resumedAs', () => {
  const since = Date.parse('2026-10-10T08:40:29Z')
  const agent = (fields: Partial<AgentEntry>): AgentEntry => ({
    cwd: 'C:/repo/.claude/worktrees/ABC-1',
    kind: 'bg',
    startedAt: since + 1_000,
    sessionId: 'old',
    name: 'ABC-1',
    state: 'running',
    ...fields,
  })
  const match = resumedAs('old', 'ABC-1', 'c:\\repo\\.claude\\worktrees\\ABC-1', since)

  it('finds the resumed session under its own id', () => {
    expect(match(agent({}))).toBe(true)
  })

  it('finds the resumed session under the new id the CLI gave it', () => {
    expect(match(agent({ sessionId: 'new' }))).toBe(true)
  })

  it('does not take the stopped session that was resumed', () => {
    expect(match(agent({ state: 'stopped', startedAt: since - 3_600_000 }))).toBe(false)
  })

  it('does not take an earlier session of the task, another task or another folder', () => {
    expect(match(agent({ sessionId: 'earlier', startedAt: since - 3_600_000 }))).toBe(false)
    expect(match(agent({ sessionId: 'new', name: 'ABC-2' }))).toBe(false)
    expect(match(agent({ sessionId: 'new', cwd: 'C:/repo' }))).toBe(false)
  })
})
