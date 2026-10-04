import { describe, expect, it } from 'vitest'
import { launchPlan } from './launch.js'

describe('launchPlan', () => {
  const prompts = { sonnet: 'You are Sonnet.' }

  it('launches a task without a model label on the default model with the prompt as is', () => {
    expect(launchPlan({ id: 'ABC-1', models: [] }, 'ABC-1', 'opus', prompts)).toEqual({ model: 'opus', prompt: 'ABC-1', warning: null })
  })

  it('launches a task the chain no longer knows on the default model', () => {
    expect(launchPlan(undefined, 'ABC-1', 'haiku', prompts)).toEqual({ model: 'haiku', prompt: 'ABC-1', warning: null })
  })

  it('appends the prompt of the default model to a task without a model label', () => {
    expect(launchPlan({ id: 'ABC-1', models: [] }, 'ABC-1', 'sonnet', prompts)).toEqual({
      model: 'sonnet',
      prompt: 'ABC-1\n\nYou are Sonnet.',
      warning: null,
    })
  })

  it('passes the model of the label over the default one and appends its prompt', () => {
    expect(launchPlan({ id: 'ABC-1', models: ['sonnet'] }, 'ABC-1', 'opus', prompts)).toEqual({
      model: 'sonnet',
      prompt: 'ABC-1\n\nYou are Sonnet.',
      warning: null,
    })
  })

  it('keeps the prompt as is for a model without a configured prompt', () => {
    expect(launchPlan({ id: 'ABC-1', models: ['haiku'] }, 'ABC-1', 'opus', prompts)).toEqual({ model: 'haiku', prompt: 'ABC-1', warning: null })
  })

  it('falls back to the default model with a warning when two model labels disagree', () => {
    const plan = launchPlan({ id: 'ABC-1', models: ['sonnet', 'haiku'] }, 'ABC-1', 'opus', prompts)
    expect(plan.model).toBe('opus')
    expect(plan.prompt).toBe('ABC-1')
    expect(plan.warning).toMatch(/ABC-1.*sonnet.*haiku.*opus/)
  })
})
