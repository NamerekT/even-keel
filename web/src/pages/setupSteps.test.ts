import { describe, expect, it } from 'vitest'
import { accountShortName, profileShortName, setupStep, stepBeside, stepPath } from './setupSteps.js'

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

describe('accountShortName', () => {
  it('keeps the part of an e-mail before the at sign, for the line under a done step', () => {
    expect(accountShortName('john.doe@example.com')).toBe('john.doe')
  })

  it('keeps a name that is no e-mail', () => {
    expect(accountShortName('Work')).toBe('Work')
    expect(accountShortName('@handle')).toBe('@handle')
  })
})

describe('profileShortName', () => {
  it('drops the tracker name a profile name starts with, inside that tracker card', () => {
    expect(profileShortName('Huly · example', 'Huly')).toBe('example')
    expect(profileShortName('GitHub · octo-org', 'GitHub')).toBe('octo-org')
  })

  it('keeps a name of its own whole', () => {
    expect(profileShortName('Work tracker', 'Huly')).toBe('Work tracker')
    expect(profileShortName('Huly', 'Huly')).toBe('Huly')
  })
})
