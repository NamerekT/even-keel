import { describe, expect, it } from 'vitest'
import { lampOf } from '../../../src/sessions/agents.js'
import { t } from '../i18n/index.js'
import { lockReason } from './composerLock.js'

const stopped = { lamp: 'error' as const, waitingFor: null, asking: false }

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
