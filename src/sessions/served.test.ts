import { describe, expect, it, vi } from 'vitest'
import type { LaunchEntry } from '../chain/model.js'
import { machinePermission, servedSession } from './served.js'

const launch = { at: '2026-11-27T10:00:00Z', project: 'p-1', task: 'ABC-1', sessionId: 's-task', account: 'global', reason: 'start' } as LaunchEntry
const views = [
  { task: 'chat-a04c9c40656f', sessionId: 's-chat' },
  { task: 'ABC-2', sessionId: 's-hand' },
]

describe('servedSession', () => {
  it('serves a session the chain launched and a project chat (BTN-1769)', () => {
    expect(servedSession([launch], views, 's-task')).toBe(true)
    expect(servedSession([launch], views, 's-chat')).toBe(true)
  })

  it('serves no session the service did not start', () => {
    expect(servedSession([launch], views, 's-hand')).toBe(false)
    expect(servedSession([launch], views, 's-other')).toBe(false)
  })
})

describe('machinePermission', () => {
  const approvals = { poll: vi.fn(() => null) }

  it("asks the machine's approvals for a session it serves, and answers 404 for another", () => {
    const poll = machinePermission(() => ({ journal: [launch], sessions: views, approvals }))
    expect(poll('s-chat', 'Bash', { command: 'rm a' }, 5)).toBeNull()
    expect(approvals.poll).toHaveBeenCalledWith('s-chat', 'Bash', { command: 'rm a' }, 5)
    expect(poll('s-hand', 'Bash', {}, 5)).toBeUndefined()
  })

  it('keeps the call waiting until the machine is up', () => {
    expect(machinePermission(() => undefined)('s-chat', 'Bash', {}, 5)).toBeNull()
  })
})
