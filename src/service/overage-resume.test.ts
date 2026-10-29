import { expect, it, vi } from 'vitest'
import type { HandoffSession } from '../chain/relay.js'
import { resumeWith } from './chain.js'

it('resumes a retained paid-usage session without another stop or a write to its ended process', async () => {
  const stopIn = vi.fn()
  const reply = vi.fn()
  const resumeIn = vi.fn().mockResolvedValue('session-1')
  const ctx = {
    monitor: { holds: { during: (_id: string, action: () => Promise<string>) => action() } },
    approved: () => false,
    homeOf: () => ({ key: 'global' }),
    goOnWith: () => ({ prompt: 'Continue' }),
    liveView: () => undefined,
    agentOf: () => ({ reply }),
    daemons: { prepare: vi.fn() }, stopIn, resumeIn,
  } as unknown as Parameters<typeof resumeWith>[0]
  const session = { sessionId: 'session-1', account: 'global', stopped: true } as HandoffSession
  expect(await resumeWith(ctx, 'ABC-1', session, 'Continue')).toBe('session-1')
  expect(stopIn).not.toHaveBeenCalled()
  expect(reply).not.toHaveBeenCalled()
  expect(resumeIn).toHaveBeenCalledOnce()
})
