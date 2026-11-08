import { describe, expect, it } from 'vitest'
import { previewModels } from './modelPromptPreview.js'

const catalog = [
  { provider: 'claude', models: ['sonnet', 'sonnet[1m]', 'opus'], complete: false },
  { provider: 'codex', models: ['gpt-sol'], complete: false },
  { provider: 'opencode', models: ['anthropic/claude-sonnet-5-5', 'opencode/other'], complete: true },
]

describe('model prompt preview', () => {
  it('groups matches across providers and retains catalogue completeness', () => {
    expect(previewModels('* | *sonnet*', catalog)).toEqual([
      { ...catalog[0], models: ['sonnet', 'sonnet[1m]'], all: false },
      { ...catalog[1], models: [], all: false },
      { ...catalog[2], models: ['anthropic/claude-sonnet-5-5'], all: false },
    ])
  })

  it('marks a pattern that takes every model of the provider', () => {
    expect(previewModels('OpenCode | *', catalog)).toEqual([{ ...catalog[2], all: true }])
    expect(previewModels('* | **', catalog).map((entry) => entry.all)).toEqual([true, true, true])
    expect(previewModels('OpenCode | opencode/*', catalog)).toEqual([{ ...catalog[2], models: ['opencode/other'], all: false }])
  })

  it('limits a bare provider to its own catalogue', () => {
    expect(previewModels('Codex', catalog)).toEqual([{ ...catalog[1], all: true }])
    expect(previewModels('Claude | missing*', catalog)).toEqual([{ ...catalog[0], models: [], all: false }])
    expect(previewModels('Missing | *', catalog)).toEqual([])
    expect(previewModels('Claude |', catalog)).toEqual([])
  })
})
