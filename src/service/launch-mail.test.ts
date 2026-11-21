import { describe, expect, it, vi } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import type { SessionPlugin } from '../agent/contract.js'
import { fail } from '../notice/notice.js'
import { wireLaunchIn, wireResumeIn } from './accounts.js'

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

  it('marks nothing when the resume fails', async () => {
    const { ctx, expect: expected } = setup(async () => { throw fail('claude.resumeFailed', { task: 'ABC-1', cwd: 'D:/checkout' }) })
    const start = { name: 'ABC-1', cwd: 'D:/checkout', prompt: 'go', model: null, plugins: [BRIDGE] }
    await expect(wireResumeIn(ctx)(home, handle, start)).rejects.toThrow()
    expect(expected).not.toHaveBeenCalled()
  })
})
