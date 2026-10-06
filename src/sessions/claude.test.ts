import { describe, expect, it } from 'vitest'
import { sessionArgs } from './claude.js'

describe('sessionArgs', () => {
  it('passes the chain settings with --settings only when there are any', () => {
    expect(sessionArgs('ABC-1', 'opus')).toEqual(['--bg', '--permission-mode', 'auto', '-n', 'ABC-1', '--model', 'opus'])
    expect(sessionArgs('ABC-1', 'opus', '{"syncClaudeAiSkills":false}').slice(-2)).toEqual(['--settings', '{"syncClaudeAiSkills":false}'])
  })
})
