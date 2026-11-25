import { describe, expect, it } from 'vitest'
import type { InviteView } from '../../../src/access/view.js'
import { inviteStage, liveInvites } from './inviteStage.js'

const opened = { device: 'Chrome on Android', from: '192.0.2.7', at: '2026-01-01T10:00:00.000Z', digits: '64' }
const waiting: InviteView = { id: 'a', createdAt: '2026-01-01T10:00:00.000Z', expiresAt: '2026-01-01T10:10:00.000Z', opened: null }
const openedInvite: InviteView = { id: 'a', createdAt: '2026-01-01T10:00:00.000Z', expiresAt: '2026-01-01T10:10:00.000Z', opened }

describe('inviteStage', () => {
  it('waits while the invitation just made is not listed yet', () => {
    expect(inviteStage({ left: 60_000, invite: undefined, seen: false, gone: false })).toBe('waiting')
  })

  it('shows who opened it while time is left', () => {
    expect(inviteStage({ left: 60_000, invite: openedInvite, seen: true, gone: false })).toBe('opened')
  })

  it('says the link expired at zero, unopened or opened', () => {
    expect(inviteStage({ left: 0, invite: waiting, seen: true, gone: false })).toBe('expired')
    expect(inviteStage({ left: 0, invite: openedInvite, seen: true, gone: false })).toBe('expired')
    expect(inviteStage({ left: -5, invite: undefined, seen: true, gone: true })).toBe('expired')
  })

  it('says it is over once the list drops it or the hub refused a decision as gone', () => {
    expect(inviteStage({ left: 60_000, invite: undefined, seen: true, gone: false })).toBe('over')
    expect(inviteStage({ left: 60_000, invite: openedInvite, seen: true, gone: true })).toBe('over')
  })
})

describe('liveInvites', () => {
  it('drops an invitation whose time ran out by the page clock', () => {
    const now = Date.parse('2026-01-01T10:10:00.000Z')
    const later: InviteView = { id: 'b', createdAt: '2026-01-01T10:00:00.000Z', expiresAt: '2026-01-01T10:10:01.000Z', opened: null }
    expect(liveInvites([waiting, later], now)).toEqual([later])
  })
})
