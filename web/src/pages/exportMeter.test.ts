import { describe, expect, it } from 'vitest'
import { IMPORT_STEPS, meterOf } from './exportMeter.js'

const progress = (created: number, linked = 0, attached = 0, journaled = 0, marked = 0) => ({ tasks: created, created, linked, attached, journaled, marked })

describe('meterOf', () => {
  it('counts the created tasks while the first step runs', () => {
    expect(meterOf(progress(13), 28)).toEqual({ stage: 'created', step: 1, done: 13 })
  })

  it('moves to the next step once every task passed one, counting from zero', () => {
    expect(meterOf(progress(28, 0), 28)).toEqual({ stage: 'linked', step: 2, done: 0 })
    expect(meterOf(progress(28, 28, 28, 16), 28)).toEqual({ stage: 'journaled', step: 4, done: 16 })
  })

  it('names the step a stopped copy stands at', () => {
    expect(meterOf(progress(28, 28, 5), 28)).toEqual({ stage: 'attached', step: 3, done: 5 })
  })

  it('is the whole move once every task is marked', () => {
    expect(meterOf(progress(28, 28, 28, 28, 28), 28)).toEqual({ stage: null, step: 5, done: 28 })
  })

  it('takes a task closed since as one more of the total', () => {
    expect(meterOf(progress(29, 29, 29, 29, 29), 28)).toEqual({ stage: null, step: 5, done: 29 })
  })

  it('is through with nothing to move', () => {
    expect(meterOf(progress(0), 0)).toEqual({ stage: null, step: 5, done: 0 })
  })
})

describe('meterOf on the import', () => {
  const imported = (created: number, linked = 0, attached = 0, journaled = 0) => ({ tasks: created, created, linked, attached, journaled, done: journaled })

  it('goes through four steps, the journal last', () => {
    expect(meterOf(imported(40, 40, 40, 12), 40, IMPORT_STEPS)).toEqual({ stage: 'journaled', step: 4, done: 12 })
  })

  it('is the whole move once every journal is written', () => {
    expect(meterOf(imported(40, 40, 40, 40), 40, IMPORT_STEPS)).toEqual({ stage: null, step: 4, done: 40 })
  })
})
