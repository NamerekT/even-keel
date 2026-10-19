import { describe, expect, it } from 'vitest'
import { DaemonRefresh, type DaemonVersion } from './daemon.js'
import type { AccountHome } from './homes.js'

const home: AccountHome = { key: 'jane.roe', dir: 'C:/accounts/jane.roe', global: false }

function setup(shared: boolean[], running: number[], stop: () => Promise<void> = async () => {}, daemons: (DaemonVersion | null | Error)[] = []) {
  const stopped: string[] = []
  const errors: unknown[] = []
  let changes = 0
  const refresh = new DaemonRefresh({
    share: () => shared.shift() ?? false,
    running: async () => running.shift() ?? 0,
    daemon: async () => {
      const next = daemons.shift() ?? null
      if (next instanceof Error) throw next
      return next
    },
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

  const newer = { running: '2.1.303', wanted: '2.1.301' }

  it('restarts a daemon on another version than the pinned one when no session of the folder is live', async () => {
    const { refresh, stopped, changes } = setup([false], [0], undefined, [newer])
    await refresh.prepare(global)
    expect(stopped).toEqual(['global'])
    expect(refresh.outdated()).toEqual([])
    expect(refresh.pending('global')).toBe(false)
    expect(changes()).toBe(0)
  })

  it('names a daemon on another version while its sessions live, without a pending config, and restarts it after them', async () => {
    const { refresh, stopped, changes } = setup([false, false], [1, 0], undefined, [newer, newer])
    await refresh.prepare(home)
    expect(stopped).toEqual([])
    expect(refresh.outdated()).toEqual([{ account: 'jane.roe', ...newer }])
    expect(refresh.pending(home.key)).toBe(false)
    expect(changes()).toBe(1)

    await refresh.prepare(home)
    expect(stopped).toEqual(['jane.roe'])
    expect(refresh.outdated()).toEqual([])
    expect(changes()).toBe(2)
  })

  it('leaves a daemon on the pinned version, none at all, or one it could not ask alone', async () => {
    const { refresh, stopped, errors } = setup([false, false, false], [0, 0, 0], undefined, [{ running: '2.1.301', wanted: '2.1.301' }, null, new Error('claude: no answer')])
    await refresh.prepare(home)
    await refresh.prepare(home)
    await refresh.prepare(home)
    expect(stopped).toEqual([])
    expect(errors).toHaveLength(1)
  })

  it('forgets a daemon it named once it runs the pinned version again', async () => {
    const { refresh, changes } = setup([false, false], [1, 1], undefined, [newer, { running: '2.1.301', wanted: '2.1.301' }])
    await refresh.prepare(home)
    await refresh.prepare(home)
    expect(refresh.outdated()).toEqual([])
    expect(changes()).toBe(2)
  })
})
