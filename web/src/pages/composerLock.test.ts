import { describe, expect, it } from 'vitest'
import { lampOf } from '../../../src/sessions/agents.js'
import { t } from '../i18n/index.js'
import type { PackageCell, PackagesView } from '../../../src/state.js'
import { checkpointOffer, lockReason } from './composerLock.js'

const stopped = { lamp: 'error' as const, waitingFor: null, asking: false }

const cell = (enabled: boolean): PackageCell => ({ choice: null, enabled, settings: {}, problems: [] })
const packages = (cells: Record<string, PackageCell>, marketplace: PackagesView['marketplace'] = { name: 'even-keel', dir: 'C:\\even-keel', known: true }): PackagesView => ({
  gateway: null,
  packages: [],
  projects: { ABC: { cells, problems: [], blocked: false, tracker: null } },
  keys: [],
  available: [],
  marketplace,
  imports: {},
  skills: { package: 'my-skills@even-keel-skills', list: [] },
})

describe('checkpointOffer', () => {
  it('offers the checkpoint plugin of the own marketplace to a project without it', () => {
    expect(checkpointOffer(packages({}), 'ABC')).toBe('checkpoint@even-keel')
    expect(checkpointOffer(packages({ 'checkpoint@even-keel': cell(false) }), 'ABC')).toBe('checkpoint@even-keel')
    expect(checkpointOffer(packages({}), 'XYZ')).toBe('checkpoint@even-keel')
  })

  it('offers nothing once the project has it on', () => {
    expect(checkpointOffer(packages({ 'checkpoint@even-keel': cell(true) }), 'ABC')).toBeNull()
  })

  it('names the marketplace the checkout has', () => {
    expect(checkpointOffer(packages({}, { name: 'my-fork', dir: 'C:\\fork', known: true }), 'ABC')).toBe('checkpoint@my-fork')
  })

  it('offers nothing without an own marketplace or the packages view', () => {
    expect(checkpointOffer(packages({}, null), 'ABC')).toBeNull()
    expect(checkpointOffer(null, 'ABC')).toBeNull()
  })
})

describe('lockReason', () => {
  it('allows a reply after a turn ended on an API error', () => {
    expect(lockReason(stopped, false)).toBeNull()
  })

  it('keeps a turn that is still retrying locked', () => {
    expect(lockReason({ ...stopped, lamp: 'working' }, false)).toBe(t.session.chat.working)
  })

  it.each(['background', 'sdk'])('uses the turn status after a Claude %s API error', (kind) => {
    const agent = { kind, pid: 123, cwd: 'C:/repos/example', sessionId: 'example', startedAt: Date.now() }
    const idle = lampOf({ ...agent, status: 'idle' }, 'error')
    const busy = lampOf({ ...agent, status: 'busy' }, 'error')
    expect(idle).toBe('error')
    expect(lockReason({ ...stopped, lamp: idle }, false)).toBeNull()
    expect(busy).toBe('working')
    expect(lockReason({ ...stopped, lamp: busy }, false)).toBe(t.session.chat.working)
  })

  it('keeps the task locked while a fix leads the chain, even after an API error', () => {
    expect(lockReason(stopped, true)).toBe(t.session.chat.aside)
  })

  it('keeps an unanswered CLI dialog locked, even with an API error', () => {
    expect(lockReason({ ...stopped, waitingFor: 'permission' }, false)).toBe(t.session.chat.dialog('permission'))
  })

  it('allows an explicit question to be answered', () => {
    expect(lockReason({ ...stopped, waitingFor: 'input needed', asking: true }, false)).toBeNull()
  })

  it('allows a reply to a waiting session', () => {
    expect(lockReason({ ...stopped, lamp: 'waiting' }, false)).toBeNull()
  })

  it.each(['finished', 'limit'] as const)('keeps a %s session locked', (lamp) => {
    expect(lockReason({ ...stopped, lamp }, false)).toBe(t.session.chat[lamp])
  })
})
