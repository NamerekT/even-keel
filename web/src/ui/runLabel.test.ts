import { describe, expect, it } from 'vitest'
import { effortLevel, runView } from './runLabel.js'

describe('effortLevel', () => {
  it.each([
    ['minimal', 1],
    ['low', 1],
    ['medium', 2],
    ['high', 3],
    ['xhigh', 4],
    ['max', 5],
  ])('fills %s with %i bars', (effort, bars) => {
    expect(effortLevel(effort)).toBe(bars)
  })

  it.each([null, 'none', 'turbo'])('draws no scale for %s', (effort) => {
    expect(effortLevel(effort)).toBeNull()
  })
})

describe('runView', () => {
  it.each([
    [{ provider: 'opencode', model: 'router/vendor/deepseek-v4-pro', effort: null }, { provider: 'OpenCode', model: 'deepseek-v4-pro', effort: null }],
    [{ provider: 'claude', model: 'claude-opus-5-5', effort: null }, { provider: 'Claude', model: 'Opus 5.5', effort: null }],
    [{ provider: 'opencode', model: 'openrouter/qwen/qwen3-coder:free', effort: null }, { provider: 'OpenCode', model: 'qwen3-coder', effort: null }],
    [{ provider: 'claude', model: 'opus', effort: 'high' }, { provider: 'Claude', model: 'opus', effort: 'high' }],
    [{ provider: 'codex', model: null, effort: null }, { provider: 'Codex', model: null, effort: null }],
    [{ provider: null, model: null, effort: 'low' }, { provider: null, model: null, effort: 'low' }],
  ])('shows %j', (run, expected) => {
    expect(runView(run)).toEqual(expected)
  })
})
