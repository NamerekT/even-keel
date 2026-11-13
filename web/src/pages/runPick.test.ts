import { describe, expect, it } from 'vitest'
import { effortsOf, runPickChange, runPickOf, withProvider } from './runPick.js'

describe("what the card's run fields show", () => {
  it('shows a task without a run as the project says', () => {
    expect(runPickOf(undefined)).toEqual({ provider: '', model: '', effort: '' })
    expect(runPickOf(null)).toEqual({ provider: '', model: '', effort: '' })
  })

  it('shows each field of the run, an unset one empty', () => {
    expect(runPickOf({ provider: 'claude', model: 'opus', effort: 'high' })).toEqual({ provider: 'claude', model: 'opus', effort: 'high' })
    expect(runPickOf({ provider: null, model: null, effort: 'low' })).toEqual({ provider: '', model: '', effort: 'low' })
  })
})

describe('the efforts the pick offers', () => {
  it("offers the picked provider's own", () => {
    expect(effortsOf('codex', 'claude')).toContain('minimal')
    expect(effortsOf('claude', 'codex')).toContain('max')
  })

  it("offers the project's provider's when none is picked", () => {
    expect(effortsOf('', 'claude')).toEqual(effortsOf('claude', ''))
  })

  it('offers none for a provider that takes no effort', () => {
    expect(effortsOf('opencode', 'claude')).toEqual([])
    expect(effortsOf('', 'copilot')).toEqual([])
  })
})

describe('another provider picked', () => {
  it('drops the model and keeps an effort the new provider takes', () => {
    expect(withProvider({ provider: 'claude', model: 'opus', effort: 'high' }, 'codex', 'claude')).toEqual({ provider: 'codex', model: '', effort: 'high' })
  })

  it('drops an effort the new provider does not take', () => {
    expect(withProvider({ provider: 'claude', model: '', effort: 'max' }, 'codex', 'claude').effort).toBe('')
    expect(withProvider({ provider: 'claude', model: '', effort: 'high' }, 'opencode', 'claude').effort).toBe('')
    expect(withProvider({ provider: 'codex', model: '', effort: 'minimal' }, '', 'claude').effort).toBe('')
  })

  it('leaves the pick alone when the provider is the same', () => {
    const pick = { provider: 'claude', model: 'opus', effort: 'max' }
    expect(withProvider(pick, 'claude', 'codex')).toBe(pick)
  })
})

describe('the run a pick asks for', () => {
  it('is nothing when the task has it already', () => {
    expect(runPickChange(undefined, { provider: '', model: '', effort: '' })).toBeNull()
    expect(runPickChange({ provider: 'claude', model: 'opus', effort: null }, { provider: 'claude', model: ' opus ', effort: '' })).toBeNull()
  })

  it('names every field, an empty one as unset', () => {
    expect(runPickChange(undefined, { provider: 'codex', model: '', effort: 'high' })).toEqual({ provider: 'codex', model: null, effort: 'high' })
    expect(runPickChange(undefined, { provider: '', model: '', effort: 'low' })).toEqual({ provider: null, model: null, effort: 'low' })
  })

  it('clears the run when every field is emptied', () => {
    expect(runPickChange({ provider: 'claude', model: 'opus', effort: 'high' }, { provider: '', model: '', effort: '' })).toEqual({ provider: null, model: null, effort: null })
  })

  it('names no model without a provider', () => {
    expect(runPickChange({ provider: 'claude', model: 'opus', effort: null }, { provider: '', model: 'opus', effort: '' })?.model).toBeNull()
  })
})
