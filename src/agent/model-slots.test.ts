import { describe, expect, it } from 'vitest'
import { isModelSlot, MODEL_SLOTS, modelOf, modelSlot, slotOfModel, slotProvider, vendorOf } from './model-slots.js'

describe('model slots (BTN-984)', () => {
  it('keeps one slot a provider and one an OpenCode provider', () => {
    expect(MODEL_SLOTS).toEqual([
      'claude',
      'codex',
      'opencode/openai',
      'opencode/anthropic',
      'opencode/openrouter',
      'opencode/github-copilot',
      'opencode/opencode-go',
      'opencode/opencode',
      'copilot',
    ])
    expect(isModelSlot('codex')).toBe(true)
    expect(isModelSlot('opencode/openrouter')).toBe(true)
    expect(isModelSlot('opencode')).toBe(false)
    expect(isModelSlot('opencode/groq')).toBe(false)
    expect(isModelSlot('gemini')).toBe(false)
  })

  it('names the OpenCode provider a folder is signed in to, the first known one first', () => {
    expect(vendorOf([])).toBe('opencode')
    expect(vendorOf(['openai'])).toBe('openai')
    expect(vendorOf(['openrouter', 'openai'])).toBe('openai')
    expect(vendorOf(['opencode-go'])).toBe('opencode-go')
    expect(vendorOf(['groq'])).toBe('opencode')
  })

  it('takes the slot of a provider, the OpenCode one by the folder it runs on', () => {
    expect(modelSlot('codex', 'openai')).toBe('codex')
    expect(modelSlot('opencode', 'openrouter')).toBe('opencode/openrouter')
    expect(modelSlot('opencode', null)).toBe('opencode/opencode')
    expect(slotProvider('opencode/openai')).toBe('opencode')
    expect(slotProvider('claude')).toBe('claude')
  })

  it('reads a model by its slot', () => {
    const models = { codex: 'gpt-6-luna', 'opencode/openai': 'openai/gpt-6-luna', 'opencode/opencode': 'opencode/big-pickle' }
    expect(modelOf(models, 'codex', null)).toBe('gpt-6-luna')
    expect(modelOf(models, 'opencode', 'openai')).toBe('openai/gpt-6-luna')
    expect(modelOf(models, 'opencode', null)).toBe('opencode/big-pickle')
    expect(modelOf(models, 'opencode', 'openrouter')).toBeUndefined()
  })

  it('places an OpenCode model of an older config by its prefix', () => {
    expect(slotOfModel('openai/gpt-6-luna')).toBe('opencode/openai')
    expect(slotOfModel(' openrouter/anthropic/claude-sonnet ')).toBe('opencode/openrouter')
    expect(slotOfModel('groq/llama')).toBe('opencode/opencode')
    expect(slotOfModel('big-pickle')).toBe('opencode/opencode')
  })
})
