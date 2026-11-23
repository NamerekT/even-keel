import { describe, expect, it } from 'vitest'
import { modelAfterSwitch } from './modelReset.js'

describe('model after an account switch', () => {
  it('clears a model the new account’s full list lacks', () => {
    expect(modelAfterSwitch('openai/gpt-6.1-sol', { models: ['anthropic/claude-sonnet-5-5'], complete: true })).toBe('')
  })

  it('keeps a model the full list names', () => {
    expect(modelAfterSwitch('anthropic/claude-sonnet-5-5', { models: ['anthropic/claude-sonnet-5-5'], complete: true })).toBe('anthropic/claude-sonnet-5-5')
  })

  it('keeps a model the full list runs without offering it', () => {
    expect(modelAfterSwitch('gpt-reserve', { models: ['gpt-6-luna'], unlisted: ['gpt-reserve'], complete: true })).toBe('gpt-reserve')
  })

  it('keeps any model against a list of aliases', () => {
    expect(modelAfterSwitch('claude-opus-5-5', { models: ['sonnet', 'opus'], complete: false })).toBe('claude-opus-5-5')
  })

  it('keeps the model when the account names no list', () => {
    expect(modelAfterSwitch('openai/gpt-6.1-sol', null)).toBe('openai/gpt-6.1-sol')
  })

  it('leaves an empty field empty', () => {
    expect(modelAfterSwitch('', { models: ['anthropic/claude-sonnet-5-5'], complete: true })).toBe('')
  })

  it('compares the model as the field trims it', () => {
    expect(modelAfterSwitch(' anthropic/claude-sonnet-5-5 ', { models: ['anthropic/claude-sonnet-5-5'], complete: true })).toBe(' anthropic/claude-sonnet-5-5 ')
  })
})
