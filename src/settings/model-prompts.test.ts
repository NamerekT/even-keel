import { describe, expect, it } from 'vitest'
import { parseConfig } from '../config.js'
import { configOfFile } from './import.js'

describe('model prompt settings', () => {
  it('accepts provider-only and wildcard patterns without catalogue matches', () => {
    const prompts = { Codex: 'Use the rules.', '* | *sonnet*': 'Check tests.', 'Missing | custom*': 'Custom.' }
    expect(parseConfig({ version: 17, projects: [], modelPrompts: prompts }).modelPrompts).toEqual(prompts)
  })

  it.each(['', ' | sonnet', 'Claude |', 'Claude | sonnet | extra'])('rejects a malformed pattern %s', (pattern) => {
    expect(() => parseConfig({ version: 17, projects: [], modelPrompts: { [pattern]: 'Test.' } })).toThrow(/Model prompts/)
  })

  it('imports old model-only keys through the schema migration', () => {
    const imported = configOfFile({ version: 16, projects: [], modelPrompts: { sonnet: 'Test.' } })
    expect(imported.contents.rows.find((row) => row.key === 'modelPrompts')?.value).toEqual({ '* | sonnet': 'Test.' })
  })
})
