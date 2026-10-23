import { describe, expect, it } from 'vitest'
import { setupStep, stepBeside, stepPath } from './setupSteps.js'

describe('setupStep', () => {
  it('reads the step of the address, the first one where it names none it knows', () => {
    expect(setupStep(new URLSearchParams('step=tracker'))).toBe('tracker')
    expect(setupStep(new URLSearchParams('step=stats&db=server'))).toBe('stats')
    expect(setupStep(new URLSearchParams('step=service'))).toBe('language')
    expect(setupStep(new URLSearchParams(''))).toBe('language')
  })
})

describe('stepBeside', () => {
  it('goes through the steps with the stats last', () => {
    expect(stepBeside('language', 1)).toBe('agent')
    expect(stepBeside('updates', 1)).toBe('stats')
    expect(stepBeside('stats', 1)).toBeNull()
    expect(stepBeside('language', -1)).toBeNull()
    expect(stepBeside('agent', -1)).toBe('language')
  })

  it('makes the address of a step', () => {
    expect(stepPath('agent')).toBe('/setup?step=agent')
  })
})
