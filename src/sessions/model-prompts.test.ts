import { describe, expect, it } from 'vitest'
import { modelPromptMatches, promptPatternOf } from './model-prompts.js'

describe('model prompt patterns', () => {
  it.each([
    [' Claude | SONNET* ', 'claude', 'sonnet[1m]', true],
    ['* | *sonnet*', 'opencode', 'anthropic/claude-sonnet-5-5', true],
    ['Claude | sonnet*', 'opencode', 'sonnet', false],
    ['Cod*', 'codex', null, true],
    ['Codex | *', 'codex', null, false],
    ['* | sonnet', 'claude', 'claude-sonnet-5-5', false],
    ['* | sonnet[1m]', 'claude', 'sonnet[1m]', true],
    ['* | sonnet[1m]', 'claude', 'sonnet1', false],
    ['* | gpt.6+', 'codex', 'gptx666', false],
    ['* | ***sonnet**', 'claude', 'sonnet', true],
    ['', 'claude', 'sonnet', false],
    ['Claude | ', 'claude', 'sonnet', false],
    ['Claude | sonnet | extra', 'claude', 'sonnet', false],
  ] as const)('matches %s against %s / %s: %s', (pattern, provider, model, expected) => {
    expect(modelPromptMatches(pattern, provider, model)).toBe(expected)
  })

  it('trims the run-label separator and accepts only one separator', () => {
    expect(promptPatternOf(' Claude  |  sonnet* ')).toEqual({ provider: 'Claude', model: 'sonnet*' })
    expect(promptPatternOf('| sonnet')).toBeNull()
  })
})
