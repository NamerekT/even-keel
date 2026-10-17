import { describe, expect, it } from 'vitest'
import { launchPlan } from './launch.js'

describe('launchPlan', () => {
  const prompts = { sonnet: 'You are Sonnet.' }
  const task = (models: ('sonnet' | 'opus' | 'haiku')[], labels: string[] = models) => ({ id: 'ABC-1', models, labels })

  it('launches a task without a model label on the default model with the prompt as is', () => {
    expect(launchPlan(task([]), 'ABC-1', 'opus', prompts)).toEqual({ agent: 'claude', model: 'opus', prompt: 'ABC-1', warning: null })
  })

  it('launches a task the chain no longer knows on the default model', () => {
    expect(launchPlan(undefined, 'ABC-1', 'haiku', prompts)).toEqual({ agent: 'claude', model: 'haiku', prompt: 'ABC-1', warning: null })
  })

  it('appends the prompt of the default model to a task without a model label', () => {
    expect(launchPlan(task([]), 'ABC-1', 'sonnet', prompts)).toEqual({
      agent: 'claude',
      model: 'sonnet',
      prompt: 'ABC-1\n\nYou are Sonnet.',
      warning: null,
    })
  })

  it('passes the model of the label over the default one and appends its prompt', () => {
    expect(launchPlan(task(['sonnet']), 'ABC-1', 'opus', prompts)).toEqual({
      agent: 'claude',
      model: 'sonnet',
      prompt: 'ABC-1\n\nYou are Sonnet.',
      warning: null,
    })
  })

  it('keeps the prompt as is for a model without a configured prompt', () => {
    expect(launchPlan(task(['haiku']), 'ABC-1', 'opus', prompts)).toEqual({ agent: 'claude', model: 'haiku', prompt: 'ABC-1', warning: null })
  })

  it('falls back to the default model with a warning when two model labels disagree', () => {
    const plan = launchPlan(task(['sonnet', 'haiku']), 'ABC-1', 'opus', prompts)
    expect(plan.model).toBe('opus')
    expect(plan.prompt).toBe('ABC-1')
    expect(plan.warning).toMatch(/ABC-1.*sonnet.*haiku.*opus/)
  })

  it('launches a task on the agent of its project', () => {
    expect(launchPlan(task([]), 'ABC-1', 'sonnet', prompts, 'codex')).toEqual({ agent: 'codex', model: 'sonnet', prompt: 'ABC-1', warning: null })
    expect(launchPlan(undefined, 'ABC-1', 'opus', prompts, 'codex').agent).toBe('codex')
  })

  it('launches a task with the Codex label on Codex whatever the project runs on, its model labels left to Claude', () => {
    expect(launchPlan(task(['sonnet', 'haiku'], ['codex', 'sonnet', 'haiku']), 'ABC-1', 'opus', prompts)).toEqual({
      agent: 'codex',
      model: 'opus',
      prompt: 'ABC-1',
      warning: null,
    })
    expect(launchPlan(task([], [' CODEX ']), 'ABC-1', 'opus', prompts, 'claude').agent).toBe('codex')
  })
})
