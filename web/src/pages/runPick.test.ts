import { describe, expect, it } from 'vitest'
import { runPickChange, runPickOf } from './runPick.js'

describe('runPickOf', () => {
  it('reads no run label as the project', () => {
    expect(runPickOf(['UI', 'Bug'])).toEqual({ pick: { provider: '', model: '' }, labels: [], several: false })
  })

  it('reads a provider and a model', () => {
    expect(runPickOf(['UI', 'Claude | opus'])).toEqual({ pick: { provider: 'claude', model: 'opus' }, labels: ['Claude | opus'], several: false })
  })

  it('reads a bare provider as the project model', () => {
    expect(runPickOf(['Codex'])).toEqual({ pick: { provider: 'codex', model: '' }, labels: ['Codex'], several: false })
  })

  it('marks several run labels and picks none of them', () => {
    expect(runPickOf(['Claude | opus', 'Codex', 'UI'])).toEqual({ pick: { provider: '', model: '' }, labels: ['Claude | opus', 'Codex'], several: true })
  })

  it('takes two spellings of one run label as one', () => {
    expect(runPickOf(['Claude | opus', 'claude|opus']).several).toBe(false)
  })
})

describe('runPickChange', () => {
  it('puts one label on a task without any', () => {
    expect(runPickChange(['UI'], { provider: 'claude', model: 'sonnet' })).toEqual({ add: ['Claude | sonnet'], remove: [] })
  })

  it('puts a bare provider when the model is the project one', () => {
    expect(runPickChange([], { provider: 'codex', model: '  ' })).toEqual({ add: ['Codex'], remove: [] })
  })

  it('replaces the run label and keeps the others', () => {
    expect(runPickChange(['UI', 'Codex'], { provider: 'claude', model: 'opus' })).toEqual({ add: ['Claude | opus'], remove: ['Codex'] })
  })

  it('takes every run label off for the project', () => {
    expect(runPickChange(['Claude | opus', 'Bug', 'Codex'], { provider: '', model: 'opus' })).toEqual({ add: [], remove: ['Claude | opus', 'Codex'] })
  })

  it('replaces several run labels with one, even the one picked', () => {
    expect(runPickChange(['Claude | opus', 'Codex'], { provider: 'claude', model: 'opus' })).toEqual({ add: ['Claude | opus'], remove: ['Claude | opus', 'Codex'] })
  })

  it('changes nothing when the pick is the label there', () => {
    expect(runPickChange(['claude | opus'], { provider: 'claude', model: 'opus' })).toBeNull()
    expect(runPickChange(['UI'], { provider: '', model: '' })).toBeNull()
  })

  it('round-trips a pick through its labels', () => {
    for (const pick of [{ provider: 'claude', model: 'opus' }, { provider: 'codex', model: '' }, { provider: 'opencode', model: 'opencode/big-pickle' }]) {
      const change = runPickChange(['UI'], pick)!
      expect(runPickOf(['UI', ...change.add]).pick).toEqual(pick)
    }
  })
})
