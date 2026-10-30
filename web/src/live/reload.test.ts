import { describe, expect, it } from 'vitest'
import { assetsOf, reloadOnMissingChunk, watchBuild, type BuildWatchDeps } from './reload.js'

const OLD = '<script type="module" crossorigin src="/assets/index-OLD.js"></script><link rel="stylesheet" href="/assets/index-A.css">'
const NEW = '<script type="module" crossorigin src="/assets/index-NEW.js"></script><link rel="stylesheet" href="/assets/index-A.css">'

function harness(index: () => Promise<string>, idle = () => true) {
  const calls = { fetched: 0, reloads: 0, waits: [] as (() => void)[] }
  const deps: BuildWatchDeps = {
    loaded: OLD,
    fetchIndex: () => {
      calls.fetched++
      return index()
    },
    idle,
    reload: () => calls.reloads++,
    later: (check) => calls.waits.push(check),
  }
  return { calls, seen: watchBuild(deps) }
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('assetsOf', () => {
  it('names the built files of the page, whatever their order', () => {
    expect(assetsOf(OLD)).toBe('/assets/index-A.css /assets/index-OLD.js')
    expect(assetsOf('<link href="/assets/b.css"><script src="/assets/a.js"></script>')).toBe(assetsOf('<script src="/assets/a.js"></script><link href="/assets/b.css">'))
  })

  it('names nothing on the dev server, which serves the sources', () => {
    expect(assetsOf('<script type="module" src="/src/main.tsx"></script>')).toBe('')
  })
})

describe('watchBuild', () => {
  it('asks nothing on the first state and while the service is the same', async () => {
    const { calls, seen } = harness(async () => NEW)
    seen('2026-10-30T10:00:00Z')
    seen('2026-10-30T10:00:00Z')
    await settled()
    expect(calls.fetched).toBe(0)
  })

  it('reloads the page when a restarted service serves another build', async () => {
    const { calls, seen } = harness(async () => NEW)
    seen('2026-10-30T10:00:00Z')
    seen('2026-10-30T11:00:00Z')
    await settled()
    expect(calls.reloads).toBe(1)
  })

  it('keeps the page when the service restarted on the same build', async () => {
    const { calls, seen } = harness(async () => OLD)
    seen('2026-10-30T10:00:00Z')
    seen('2026-10-30T11:00:00Z')
    await settled()
    expect(calls.fetched).toBe(1)
    expect(calls.reloads).toBe(0)
  })

  it('waits while the user is busy and reloads once they are done', async () => {
    let busy = true
    const { calls, seen } = harness(async () => NEW, () => !busy)
    seen('2026-10-30T10:00:00Z')
    seen('2026-10-30T11:00:00Z')
    await settled()
    expect(calls.reloads).toBe(0)
    calls.waits.shift()!()
    expect(calls.reloads).toBe(0)
    busy = false
    calls.waits.shift()!()
    expect(calls.reloads).toBe(1)
  })

  it('asks again on the next state when the page could not be fetched', async () => {
    let fail = true
    const { calls, seen } = harness(async () => {
      if (fail) throw new Error('offline')
      return NEW
    })
    seen('2026-10-30T10:00:00Z')
    seen('2026-10-30T11:00:00Z')
    await settled()
    expect(calls.reloads).toBe(0)
    fail = false
    seen('2026-10-30T11:00:00Z')
    await settled()
    expect(calls.reloads).toBe(1)
  })

  it('asks once while a check is in flight', async () => {
    const { calls, seen } = harness(async () => OLD)
    seen('2026-10-30T10:00:00Z')
    seen('2026-10-30T11:00:00Z')
    seen('2026-10-30T11:00:00Z')
    await settled()
    expect(calls.fetched).toBe(1)
  })
})

describe('reloadOnMissingChunk', () => {
  function storage() {
    const items = new Map<string, string>()
    return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) }
  }

  it('reloads the page, but not again within a few seconds: a file missing from the new build too must not loop', () => {
    const store = storage()
    let reloads = 0
    const reload = () => reloads++
    reloadOnMissingChunk(store, 1_000_000, reload)
    reloadOnMissingChunk(store, 1_005_000, reload)
    expect(reloads).toBe(1)
    reloadOnMissingChunk(store, 1_020_000, reload)
    expect(reloads).toBe(2)
  })
})
