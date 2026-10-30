import { describe, expect, it } from 'vitest'
import type { CliCopyView } from '../../../src/agent/cli-state.js'
import { accountShortName, agentReady, profileShortName, setupStep, stepBeside, stepPath } from './setupSteps.js'

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

describe('agentReady', () => {
  const copy = (source: CliCopyView['source'], status: CliCopyView['status'], system: boolean): CliCopyView =>
    ({ version: '1.0.0', source, status, system, received: 0, total: 0, approximate: 0 })
  const signedIn = { missing: [], accounts: [{ key: 'opencode', agent: 'opencode' }] }

  it('lets the setup on once the agent has a CLI to run and an account', () => {
    expect(agentReady('opencode', copy('system', 'missing', true), signedIn, 'opencode')).toBe(true)
    expect(agentReady('opencode', copy('checked', 'ready', false), signedIn, 'opencode')).toBe(true)
  })

  it('counts a copy still downloading as one to run', () => {
    expect(agentReady('opencode', copy('checked', 'downloading', false), signedIn, 'opencode')).toBe(true)
  })

  it('holds it without a CLI: none installed, or the copy missing or failed', () => {
    expect(agentReady('opencode', copy('system', 'missing', false), signedIn, 'opencode')).toBe(false)
    expect(agentReady('opencode', copy('checked', 'missing', true), signedIn, 'opencode')).toBe(false)
    expect(agentReady('opencode', copy('checked', 'failed', true), signedIn, 'opencode')).toBe(false)
  })

  it('holds it without an account of that agent', () => {
    expect(agentReady('opencode', copy('system', 'missing', true), { missing: [], accounts: [] }, 'opencode')).toBe(false)
    expect(agentReady('opencode', copy('system', 'missing', true), { missing: [], accounts: [{ key: 'opencode', agent: 'codex' }] }, 'opencode')).toBe(false)
  })

  it('reads the installed CLI from the accounts without copies', () => {
    expect(agentReady('opencode', undefined, signedIn, 'opencode')).toBe(true)
    expect(agentReady('opencode', undefined, { ...signedIn, missing: ['opencode'] }, 'opencode')).toBe(false)
  })
})
