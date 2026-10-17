import { describe, expect, it } from 'vitest'
import type { RunLabel } from '../tracker/model.js'
import { launchPlan, runChoice, type RunSettings } from './launch.js'

describe('runChoice', () => {
  const run: RunSettings = {
    provider: 'claude',
    models: { claude: 'opus', codex: 'gpt-6.1-sol' },
    accounts: { claude: 'global', codex: 'codex' },
    labels: true,
  }
  const task = (...runLabels: RunLabel[]) => ({ id: 'ABC-1', runLabels })
  const any = () => true

  it('runs a task without a run label on the provider of the project, with its model and account', () => {
    expect(runChoice(task(), run, any)).toEqual({ provider: 'claude', account: 'global', model: 'opus', fallback: null, warning: null })
    expect(runChoice(undefined, { ...run, provider: 'codex' }, any)).toMatchObject({ provider: 'codex', account: 'codex', model: 'gpt-6.1-sol' })
  })

  it('leaves the model to the CLI when no level of the config names one', () => {
    expect(runChoice(task(), { ...run, provider: 'codex', models: { claude: 'opus' } }, any).model).toBeNull()
  })

  it('takes the provider and the model of the label', () => {
    expect(runChoice(task({ provider: 'codex', model: 'gpt-6.1-luna' }), run, any)).toMatchObject({ provider: 'codex', account: 'codex', model: 'gpt-6.1-luna' })
    expect(runChoice(task({ provider: 'claude', model: 'haiku' }), run, any)).toMatchObject({ provider: 'claude', model: 'haiku' })
  })

  it('takes the model of the label provider from the config for a bare provider', () => {
    expect(runChoice(task({ provider: 'codex', model: null }), run, any)).toMatchObject({ provider: 'codex', model: 'gpt-6.1-sol' })
  })

  it('ignores the labels while they are off', () => {
    expect(runChoice(task({ provider: 'codex', model: 'gpt-6.1-luna' }), { ...run, labels: false }, any)).toMatchObject({ provider: 'claude', model: 'opus' })
  })

  it('ignores labels that disagree, with a warning', () => {
    const choice = runChoice(task({ provider: 'codex', model: null }, { provider: 'claude', model: 'haiku' }), run, any)
    expect(choice).toMatchObject({ provider: 'claude', model: 'opus', fallback: null })
    expect(choice.warning).toMatch(/ABC-1.*Codex.*Claude \| haiku/)
  })

  it('runs on the project provider and its model when the pool has no account for the label provider', () => {
    const noCodex = (provider: string) => provider !== 'codex'
    expect(runChoice(task({ provider: 'codex', model: 'gpt-6.1-luna' }), run, noCodex)).toEqual({
      provider: 'claude',
      account: 'global',
      model: 'opus',
      fallback: 'codex',
      warning: null,
    })
    expect(runChoice(task({ provider: 'codex', model: null }), { ...run, accounts: { claude: 'global' } }, any).fallback).toBe('codex')
  })
})

describe('launchPlan', () => {
  const run: RunSettings = { provider: 'claude', models: { claude: 'opus' }, accounts: { claude: 'global' }, labels: true }
  const prompts = { sonnet: 'You are Sonnet.', 'gpt-6.1-sol': 'You are Sol.' }

  it('keeps the prompt as is for a model without a configured prompt', () => {
    expect(launchPlan(undefined, 'ABC-1', run, prompts, () => true)).toMatchObject({ provider: 'claude', model: 'opus', prompt: 'ABC-1' })
  })

  it('appends the prompt of the model it runs on, whatever the case of its name', () => {
    const task = { id: 'ABC-1', runLabels: [{ provider: 'claude', model: 'Sonnet' }] }
    expect(launchPlan(task, 'ABC-1', run, prompts, () => true).prompt).toBe('ABC-1\n\nYou are Sonnet.')
  })

  it('appends no prompt for a model left to the CLI', () => {
    expect(launchPlan(undefined, 'ABC-1', { ...run, models: {} }, { ...prompts, '': 'never' }, () => true)).toMatchObject({ model: null, prompt: 'ABC-1' })
  })
})
