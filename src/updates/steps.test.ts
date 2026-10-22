import { describe, expect, it } from 'vitest'
import type { UpdateStep } from './model.js'
import { rollbackOf, runSteps, stepsOf, StepError } from './steps.js'

describe('stepsOf', () => {
  it('stops the service before the code moves, and waits for its answer last', () => {
    expect(stepsOf({ mode: 'update', install: 'ci' })).toEqual(['stop', 'fetch', 'checkout', 'install', 'build', 'start', 'answer'])
  })

  it('reverts to a tag the checkout already has, without a fetch', () => {
    expect(stepsOf({ mode: 'revert', install: 'ci' })).toEqual(['stop', 'checkout', 'install', 'build', 'start', 'answer'])
  })

  it('rebuilds with the service stopped only while dependencies are installed', () => {
    expect(stepsOf({ mode: 'rebuild', install: 'install' })).toEqual(['settle', 'stop', 'install', 'build', 'start', 'answer'])
    expect(stepsOf({ mode: 'rebuild', install: null })).toEqual(['build', 'settle', 'stop', 'start', 'answer'])
  })
})

describe('rollbackOf', () => {
  it('only starts the service again while the code has not moved', () => {
    expect(rollbackOf('update', 'stop')).toEqual(['start', 'answer'])
    expect(rollbackOf('update', 'fetch')).toEqual(['start', 'answer'])
  })

  it('brings back the commit that ran before, with its dependencies and build', () => {
    const back = ['stop', 'restore', 'install', 'build', 'start', 'answer']
    for (const step of ['checkout', 'install', 'build', 'start', 'answer'] as const) expect(rollbackOf('update', step)).toEqual(back)
    expect(rollbackOf('revert', 'build')).toEqual(back)
  })

  it('leaves a rebuild with the service started, as the script did', () => {
    expect(rollbackOf('rebuild', 'build')).toEqual(['start'])
    expect(rollbackOf('rebuild', 'install')).toEqual(['start'])
    expect(rollbackOf('rebuild', 'start')).toEqual([])
    expect(rollbackOf('rebuild', 'answer')).toEqual([])
  })
})

/** Steps that record their calls and fail where told. */
function stub(failing: Partial<Record<string, string>> = {}) {
  const calls: string[] = []
  const act = async (step: UpdateStep, rollback: boolean) => {
    const name = `${rollback ? 'back:' : ''}${step}`
    calls.push(name)
    const output = failing[name]
    if (output !== undefined) throw new StepError(output)
  }
  return { calls, act }
}

describe('runSteps', () => {
  const plan = { mode: 'update' as const, install: 'ci' as const }

  it('runs every step and rolls nothing back when all go through', async () => {
    const { calls, act } = stub()
    expect(await runSteps(plan, act)).toEqual({ failed: null, rollback: null })
    expect(calls).toEqual(stepsOf(plan))
  })

  for (const step of stepsOf(plan)) {
    it(`rolls back after a failed ${step}`, async () => {
      const { calls, act } = stub({ [step]: `${step} broke` })
      const outcome = await runSteps(plan, act)
      expect(outcome).toEqual({ failed: { step, output: `${step} broke` }, rollback: { failed: null } })
      const done = stepsOf(plan).slice(0, stepsOf(plan).indexOf(step) + 1)
      expect(calls).toEqual([...done, ...rollbackOf('update', step).map((name) => `back:${name}`)])
    })
  }

  it('goes on past a failed stop of the rollback: the service may be down already', async () => {
    const { calls, act } = stub({ build: 'tsc', 'back:stop': 'not running' })
    expect(await runSteps(plan, act)).toEqual({ failed: { step: 'build', output: 'tsc' }, rollback: { failed: null } })
    expect(calls.at(-1)).toBe('back:answer')
  })

  it('stops the rollback at its first other failure and names it', async () => {
    const { calls, act } = stub({ answer: 'no answer in 120 s', 'back:install': 'EPERM' })
    expect(await runSteps(plan, act)).toEqual({
      failed: { step: 'answer', output: 'no answer in 120 s' },
      rollback: { failed: { step: 'install', output: 'EPERM' } },
    })
    expect(calls.at(-1)).toBe('back:install')
  })

  it('keeps the message of an error that is not a step’s', async () => {
    const act = async (step: UpdateStep) => {
      if (step === 'fetch') throw new Error('spawn git ENOENT')
    }
    expect((await runSteps(plan, act)).failed).toEqual({ step: 'fetch', output: 'spawn git ENOENT' })
  })

  it('leaves a rebuild without a rollback record when nothing is to be undone', async () => {
    const { act } = stub({ answer: 'no answer' })
    expect(await runSteps({ mode: 'rebuild', install: null }, act)).toEqual({ failed: { step: 'answer', output: 'no answer' }, rollback: null })
  })
})
