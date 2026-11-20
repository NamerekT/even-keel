import { describe, expect, it } from 'vitest'
import { modelTip, modelVersionLabel, shortModel } from './modelLabel.js'

describe('shortModel', () => {
  it.each([
    ['claude-opus-5-5', 'Opus 5.5'],
    ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
    ['claude-sonnet-4.5', 'Sonnet 4.5'],
    ['gpt-5.1', 'GPT-5.1'],
    ['gpt-5.1-codex', 'GPT-5.1-codex'],
    ['openai/gpt-6.1-sol', 'GPT-6.1-sol'],
    ['anthropic/claude-sonnet-5-5', 'Sonnet 5.5'],
    ['openrouter/minimax/minimax-m3.1-flash', 'minimax-m3.1-flash'],
    ['opus', 'opus'],
    ['', ''],
  ])('names %s by its id as %s', (model, name) => {
    expect(shortModel(model)).toEqual({ name, free: false })
  })

  it('takes the :free suffix off into a badge', () => {
    expect(shortModel('openrouter/qwen/qwen3-coder:free')).toEqual({ name: 'qwen3-coder', free: true })
  })

  it('prefers the catalogue name, its vendor prefix cut', () => {
    expect(shortModel('openrouter/nvidia/llama-3.1-nemotron-ultra-253b-v1:free', 'NVIDIA: Llama 3.1 Nemotron Ultra 253B v1 (free)')).toEqual({
      name: 'Llama 3.1 Nemotron Ultra 253B v1',
      free: true,
    })
    expect(shortModel('opencode/qwen3-coder', 'Qwen3 Coder 480B A35B Instruct')).toEqual({ name: 'Qwen3 Coder 480B A35B Instruct', free: false })
  })

  it('falls back to the id for an empty catalogue name', () => {
    expect(shortModel('openai/gpt-5.1', '  ')).toEqual({ name: 'GPT-5.1', free: false })
    expect(shortModel('openai/gpt-5.1', null)).toEqual({ name: 'GPT-5.1', free: false })
  })
})

describe('modelTip', () => {
  it('gives the full name and the id', () => {
    expect(modelTip('openrouter/nvidia/nemotron:free', 'NVIDIA: Nemotron (free)')).toBe('NVIDIA: Nemotron (free) (openrouter/nvidia/nemotron:free)')
    expect(modelTip('claude-opus-5-5')).toBe('Opus 5.5 (claude-opus-5-5)')
  })

  it('gives the id alone when nothing names it otherwise', () => {
    expect(modelTip('opus')).toBe('opus')
  })
})

describe('modelVersionLabel', () => {
  it.each([
    ['claude-opus-5-5', 'Opus 5.5'],
    ['claude-opus-5', 'Opus 5'],
    ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
    ['google-gemini-3.1-flash-lite', 'google-gemini-3.1-flash-lite'],
  ])('shows %s as %s', (model, label) => {
    expect(modelVersionLabel(model)).toBe(label)
  })
})
