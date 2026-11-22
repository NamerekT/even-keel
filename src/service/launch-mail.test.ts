import { describe, expect, it, vi } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import type { SessionPlugin } from '../agent/contract.js'
import { fail } from '../notice/notice.js'
import { wireLaunchIn, wireResumeIn, wireStartedWithMail } from './accounts.js'

const BRIDGE: SessionPlugin = { package: 'agent-bridge@even-keel', dir: 'D:/cache/bridge', name: 'agent-bridge', marketplace: 'ek-1', marketplaceFile: 'D:/cache/bridge/m.json', servers: [] }
const OTHER: SessionPlugin = { ...BRIDGE, package: 'other@example', name: 'other' }
const home: AccountHome = { key: 'one', dir: 'D:/one', global: false, agent: 'claude' }
const handle = { agentId: 'job', sessionId: 'old' }

function setup(run: () => Promise<string>) {
  const expect = vi.fn()
  const ctx = {
    configStore: { current: { projects: { p: 'D:/checkout' }, settings: {} } },
    cliCopies: { blocked: () => null },
    requireModel: async () => {},
    agentOf: () => ({ launch: run, resume: run }),
    projectOf: () => 'p',
    cliLease: { session: async (_home: AccountHome, go: () => Promise<string>) => go() },
    keySpend: { beforeTurn: async () => {} },
    packages: { bringsMail: (plugins: SessionPlugin[] | undefined) => plugins?.some((each) => each.package === BRIDGE.package) === true },
    mailbox: { expect },
  } as unknown as Parameters<typeof wireLaunchIn>[0]
  return { ctx, expect }
}

// BTN-1430: a message right after the one that resumed the session went to the mailbox, not refused as busy.
describe('the mailbox of a session the service starts', () => {
  it.each(['launch', 'resume'] as const)('listens from the %s on when the session has the mail hooks', async (method) => {
    const { ctx, expect: expected } = setup(async () => 'new')
    const start = { name: 'ABC-1', cwd: 'D:/checkout', prompt: 'go', model: null, plugins: [OTHER, BRIDGE] }
    const id = method === 'launch' ? await wireLaunchIn(ctx)(home, start, 'p') : await wireResumeIn(ctx)(home, handle, start)
    expect(id).toBe('new')
    expect(expected).toHaveBeenCalledWith('new')
  })

  it.each(['launch', 'resume'] as const)('waits for the hooks to ask after a %s without the built-in plugin', async (method) => {
    const { ctx, expect: expected } = setup(async () => 'new')
    for (const plugins of [undefined, [OTHER]]) {
      const start = { name: 'ABC-1', cwd: 'D:/checkout', prompt: 'go', model: null, ...(plugins === undefined ? {} : { plugins }) }
      if (method === 'launch') await wireLaunchIn(ctx)(home, start, 'p')
      else await wireResumeIn(ctx)(home, handle, start)
    }
    expect(expected).not.toHaveBeenCalled()
  })

  // BTN-1506: after a restart the chat stayed shut on a session sitting in one long command.
  it('after a restart, counts the started sessions with the hooks as listening: by the task pin, or as a chat', () => {
    const journal = [
      { at: '2026-11-22T16:33:00.000Z', project: 'p', task: 'ABC-1', sessionId: 'with' },
      { at: '2026-11-22T16:34:00.000Z', project: 'p', task: 'ABC-2', sessionId: 'without' },
    ]
    const sessions = [{ task: 'ABC-3', sessionId: 'hand' }, { task: 'chat-0123456789ab', sessionId: 'chat' }]
    let chats = true
    const packages = { pinsMail: (project: string, task: string) => project === 'p' && task === 'ABC-1', chatsMail: () => chats }
    const started = wireStartedWithMail({ journal, sessions, packages } as unknown as Parameters<typeof wireStartedWithMail>[0])
    expect(['with', 'without', 'hand', 'chat', 'unknown'].filter(started)).toEqual(['with', 'chat'])
    chats = false
    expect(started('chat')).toBe(false)
  })

  it('marks nothing when the resume fails', async () => {
    const { ctx, expect: expected } = setup(async () => { throw fail('claude.resumeFailed', { task: 'ABC-1', cwd: 'D:/checkout' }) })
    const start = { name: 'ABC-1', cwd: 'D:/checkout', prompt: 'go', model: null, plugins: [BRIDGE] }
    await expect(wireResumeIn(ctx)(home, handle, start)).rejects.toThrow()
    expect(expected).not.toHaveBeenCalled()
  })
})
