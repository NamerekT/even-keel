import { describe, expect, it } from 'vitest'
import { launchPlan, runChoice, type RunSettings } from './launch.js'
import type { TaskRun } from './runs.js'

describe('runChoice', () => {
  const settings: RunSettings = {
    provider: 'claude',
    models: { claude: 'opus', codex: 'gpt-6.1-sol' },
    accounts: { claude: 'global', codex: 'codex' },
  }
  const run = (provider: string | null, model: string | null = null, effort: string | null = null): TaskRun => ({ provider, model, effort })
  const any = () => true

  it('runs a task without a run on the provider of the project, with its model and account', () => {
    expect(runChoice(undefined, settings, any)).toEqual({ provider: 'claude', account: 'global', model: 'opus', effort: null, fallback: null })
    expect(runChoice(undefined, { ...settings, provider: 'codex' }, any)).toMatchObject({ provider: 'codex', account: 'codex', model: 'gpt-6.1-sol' })
  })

  it('leaves the model to the CLI when no level of the config names one', () => {
    expect(runChoice(undefined, { ...settings, provider: 'codex', models: { claude: 'opus' } }, any).model).toBeNull()
  })

  it('takes the provider and the model of the run', () => {
    expect(runChoice(run('codex', 'gpt-6.1-luna'), settings, any)).toMatchObject({ provider: 'codex', account: 'codex', model: 'gpt-6.1-luna' })
    expect(runChoice(run('claude', 'haiku'), settings, any)).toMatchObject({ provider: 'claude', model: 'haiku' })
  })

  it('takes the model of the run’s provider from the config for a bare provider', () => {
    expect(runChoice(run('codex'), settings, any)).toMatchObject({ provider: 'codex', model: 'gpt-6.1-sol' })
  })

  it('passes the effort of the run, on the project’s provider too', () => {
    expect(runChoice(run('codex', null, 'minimal'), settings, any)).toMatchObject({ provider: 'codex', effort: 'minimal' })
    expect(runChoice(run(null, null, 'max'), settings, any)).toEqual({ provider: 'claude', account: 'global', model: 'opus', effort: 'max', fallback: null })
  })

  it('passes no effort to a provider that does not take the level', () => {
    expect(runChoice(run(null, null, 'max'), { ...settings, provider: 'codex' }, any).effort).toBeNull()
    expect(runChoice(run(null, null, 'none'), { ...settings, provider: 'claude' }, any).effort).toBeNull()
    expect(runChoice(run(null, null, 'max'), { ...settings, provider: 'copilot', accounts: { copilot: 'copilot' } }, any).effort).toBe('max')
  })

  it('runs on the project provider and its model when the pool has no account for the run’s provider', () => {
    const noCodex = (provider: string) => provider !== 'codex'
    expect(runChoice(run('codex', 'gpt-6.1-luna', 'minimal'), settings, noCodex)).toEqual({
      provider: 'claude',
      account: 'global',
      model: 'opus',
      effort: null,
      fallback: 'codex',
    })
    expect(runChoice(run('codex'), { ...settings, accounts: { claude: 'global' } }, any).fallback).toBe('codex')
  })

  it('takes the OpenCode model of the provider its account is signed in to (BTN-984)', () => {
    const open: RunSettings = {
      provider: 'opencode',
      models: { 'opencode/openai': 'openai/gpt-6-luna', 'opencode/opencode': 'opencode/big-pickle' },
      accounts: { opencode: 'opencode-chatgpt' },
    }
    const vendor = (folder: string | null) => () => folder
    expect(runChoice(undefined, open, any, vendor('openai')).model).toBe('openai/gpt-6-luna')
    expect(runChoice(undefined, open, any, vendor(null)).model).toBe('opencode/big-pickle')
    expect(runChoice(undefined, open, any, vendor('openrouter')).model).toBeNull()
    expect(runChoice(run('opencode', 'openai/gpt-6-sol'), open, any, vendor('openai')).model).toBe('openai/gpt-6-sol')
  })
})

describe('launchPlan', () => {
  const settings: RunSettings = { provider: 'claude', models: { claude: 'opus' }, accounts: { claude: 'global' } }
  const prompts = { 'Claude | sonnet*': 'You are Sonnet.', '* | gpt-6.1-sol': 'You are Sol.' }
  const on = (provider: string, model: string): TaskRun => ({ provider, model, effort: null })

  it('keeps the prompt as is for a model without a configured prompt', () => {
    expect(launchPlan(undefined, 'ABC-1', settings, prompts, () => true)).toMatchObject({ provider: 'claude', model: 'opus', prompt: 'ABC-1' })
  })

  it('appends the prompt of the model it runs on, whatever the case of its name', () => {
    expect(launchPlan(on('claude', 'Sonnet'), 'ABC-1', settings, prompts, () => true).prompt).toBe('ABC-1\n\nYou are Sonnet.')
  })

  it('appends no prompt for a model left to the CLI', () => {
    expect(launchPlan(undefined, 'ABC-1', { ...settings, models: {} }, { ...prompts, '': 'never' }, () => true)).toMatchObject({ model: null, prompt: 'ABC-1' })
  })

  it('appends every matching prompt in table order, including provider-wide prompts on the CLI default', () => {
    const prompts = { '*': 'Every session.', 'Claude | *sonnet*': 'Sonnet.', ' cLaUdE ': 'Claude.' }
    expect(launchPlan(on('claude', 'claude-sonnet-5-5'), 'ABC-1', settings, prompts, () => true).prompt).toBe('ABC-1\n\nEvery session.\n\nSonnet.\n\nClaude.')
    expect(launchPlan(undefined, 'ABC-1', { ...settings, models: {} }, prompts, () => true).prompt).toBe('ABC-1\n\nEvery session.\n\nClaude.')
  })

  it('matches the actual provider and model after account fallback', () => {
    const prompts = { Codex: 'Codex.', 'Claude | opus': 'Claude.' }
    expect(launchPlan(on('codex', 'gpt-6.1-sol'), 'ABC-1', settings, prompts, () => false).prompt).toBe('ABC-1\n\nClaude.')
  })
})
