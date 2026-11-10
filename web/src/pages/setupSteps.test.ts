import { describe, expect, it } from 'vitest'
import type { CliCopyView } from '../../../src/agent/cli-state.js'
import { accountShortName, agentReady, gitChoice, gitDownload, gitReady, gitStepReady, profileShortName, setupStep, stepBeside, stepPath } from './setupSteps.js'

describe('gitReady', () => {
  it('goes on once git is installed and has a name and an e-mail to commit with (BTN-731)', () => {
    expect(gitReady({ version: '2.47.1', name: 'John Doe', email: 'john@example.com' })).toBe(true)
    expect(gitReady({ version: '2.47.1', name: null, email: 'john@example.com' })).toBe(false)
    expect(gitReady({ version: '2.47.1', name: 'John Doe', email: null })).toBe(false)
    expect(gitReady({ version: null, name: null, email: null })).toBe(false)
  })

  it('holds the step until the service has read git', () => {
    expect(gitReady(undefined)).toBe(false)
  })
})

const READY = { version: '2.47.1', name: 'John Doe', email: 'john@example.com' }
const ABSENT = { version: null, name: null, email: null }

describe('gitChoice', () => {
  it('shows the answer once given, whether git starts or not (BTN-886)', () => {
    expect(gitChoice(false, READY)).toBe(false)
    expect(gitChoice(true, ABSENT)).toBe(true)
  })

  it('picks "Yes" before an answer when git starts, nothing when it does not or is not read yet', () => {
    expect(gitChoice(null, READY)).toBe(true)
    expect(gitChoice(null, { ...READY, name: null, email: null })).toBe(true)
    expect(gitChoice(null, ABSENT)).toBe(null)
    expect(gitChoice(null, undefined)).toBe(null)
  })
})

describe('gitStepReady', () => {
  it('goes on at once without git, even when git does not start (BTN-886)', () => {
    expect(gitStepReady(false, ABSENT)).toBe(true)
    expect(gitStepReady(false, undefined)).toBe(true)
  })

  it('with git, waits for git with a name and an e-mail', () => {
    expect(gitStepReady(true, READY)).toBe(true)
    expect(gitStepReady(true, ABSENT)).toBe(false)
    expect(gitStepReady(null, READY)).toBe(true)
    expect(gitStepReady(null, { ...READY, email: null })).toBe(false)
  })

  it('holds the step while nothing is picked', () => {
    expect(gitStepReady(null, ABSENT)).toBe(false)
  })
})

describe('gitDownload', () => {
  it('links the git download page of the service machine’s platform (EKR-54)', () => {
    expect(gitDownload('win32')).toBe('https://git-scm.com/download/win')
    expect(gitDownload('darwin')).toBe('https://git-scm.com/download/mac')
    expect(gitDownload('linux')).toBe('https://git-scm.com/download/linux')
  })
})

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
    expect(stepBeside('language', 1)).toBe('git')
    expect(stepBeside('git', 1)).toBe('agent')
    expect(stepBeside('updates', 1)).toBe('stats')
    expect(stepBeside('stats', 1)).toBeNull()
    expect(stepBeside('language', -1)).toBeNull()
    expect(stepBeside('agent', -1)).toBe('git')
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
