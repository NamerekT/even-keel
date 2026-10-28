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
      { ...catalog[0], models: ['sonnet', 'sonnet[1m]'] },
      { ...catalog[1], models: [] },
      { ...catalog[2], models: ['anthropic/claude-sonnet-5-5'] },
    ])
  })

  it('limits a bare provider to its own catalogue', () => {
    expect(previewModels('Codex', catalog)).toEqual([catalog[1]])
    expect(previewModels('Claude | missing*', catalog)).toEqual([{ ...catalog[0], models: [] }])
    expect(previewModels('Missing | *', catalog)).toEqual([])
    expect(previewModels('Claude |', catalog)).toEqual([])
  })
})
