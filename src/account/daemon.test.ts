import { describe, expect, it } from 'vitest'
import { DaemonRefresh } from './daemon.js'
import type { AccountHome } from './homes.js'

const home: AccountHome = { key: 'jane.roe', dir: 'C:/accounts/jane.roe', global: false }

function setup(shared: boolean[], running: number[], stop: () => Promise<void> = async () => {}) {
  const stopped: string[] = []
  const errors: unknown[] = []
  let changes = 0
  const refresh = new DaemonRefresh({
    share: () => shared.shift() ?? false,
    running: async () => running.shift() ?? 0,
    stopDaemon: async (target) => {
      await stop()
      stopped.push(target.key)
    },
    onChange: () => changes++,
    onError: (error) => errors.push(error),
  })
  return { refresh, stopped, errors, changes: () => changes }
}

describe('DaemonRefresh', () => {
  it('leaves the daemon alone when the share changed nothing', async () => {
    const { refresh, stopped } = setup([false], [0])
    await refresh.prepare(home)
    expect(stopped).toEqual([])
    expect(refresh.pending(home.key)).toBe(false)
  })

  it('stops the folder daemon when the share changed something and no session is unfinished', async () => {
    const { refresh, stopped } = setup([true], [0])
    await refresh.prepare(home)
    expect(stopped).toEqual(['jane.roe'])
    expect(refresh.pending(home.key)).toBe(false)
  })

  it('keeps the daemon while sessions are unfinished and stops it at the first launch after them', async () => {
    const { refresh, stopped, changes } = setup([true, false], [2, 0])
    await refresh.prepare(home)
    expect(stopped).toEqual([])
    expect(refresh.pending(home.key)).toBe(true)
    expect(changes()).toBe(1)

    await refresh.prepare(home)
    expect(stopped).toEqual(['jane.roe'])
    expect(refresh.pending(home.key)).toBe(false)
    expect(changes()).toBe(2)
  })

  it('keeps the folder pending and lets the launch go on when the daemon does not stop', async () => {
    const { refresh, errors } = setup([true], [0], async () => {
      throw new Error('claude: could not stop the daemon')
    })
    await refresh.prepare(home)
    expect(errors).toHaveLength(1)
    expect(refresh.pending(home.key)).toBe(true)
  })

  const global: AccountHome = { key: 'global', dir: 'C:/Users/john/.claude', global: true }

  it('shares nothing into the global folder and leaves its daemon alone until a key is removed from it', async () => {
    const { refresh, stopped } = setup([true], [0])
    await refresh.prepare(global)
    expect(stopped).toEqual([])
  })

  it('stops the global daemon by the same rule once a key left its settings: at once, or at the first launch after its sessions', async () => {
    const { refresh, stopped } = setup([], [1, 0])
    await refresh.expire(global)
    expect(stopped).toEqual([])
    expect(refresh.pending('global')).toBe(true)

    await refresh.prepare(global)
    expect(stopped).toEqual(['global'])
    expect(refresh.pending('global')).toBe(false)
  })
})
