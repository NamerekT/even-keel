import { describe, expect, it } from 'vitest'
import { briefOn } from './accounts.js'

/** A project `p1` on the tracker with the servers its packages bring; `f1` is its feed on the same tracker. */
function context(tracker: string, servers: string[]): Parameters<typeof briefOn>[0] {
  return {
    configStore: { current: { briefs: {}, trackers: { p1: tracker }, feeds: {} } },
    readers: () => ({ trackers: { p1: tracker, f1: tracker } }),
    packages: { bringsServer: (_project: string, server: string) => servers.includes(server) },
    profiles: { current: () => ({ profiles: [] }) },
  } as never
}

describe('briefOn', () => {
  it('leaves the brief out when the set brings the tracker server', () => {
    expect(briefOn(context('huly', ['huly']), 'p1')).toBe(false)
    expect(briefOn(context('huly', []), 'p1')).toBe(true)
  })

  it('takes the tasks server for the tracker server of a tracker it serves (BTN-882)', () => {
    expect(briefOn(context('huly', ['tasks']), 'p1')).toBe(false)
    expect(briefOn(context('github', ['tasks']), 'p1')).toBe(false)
  })

  it("takes the tasks server for a feed's tracker server too (BTN-892)", () => {
    expect(briefOn(context('huly', ['tasks']), 'p1', 'f1')).toBe(false)
    expect(briefOn(context('huly', []), 'p1', 'f1')).toBe(true)
  })

  it('leaves the brief of the built-in tracker out only when the set brings the tasks server (BTN-1680)', () => {
    expect(briefOn(context('builtin', ['tasks']), 'p1')).toBe(false)
    expect(briefOn(context('builtin', ['tasks']), 'p1', 'f1')).toBe(false)
    expect(briefOn(context('builtin', []), 'p1')).toBe(true)
    expect(briefOn(context('builtin', []), 'p1', 'f1')).toBe(true)
  })

  it('keeps an explicit brief of the built-in tracker', () => {
    const on = context('builtin', ['tasks'])
    ;(on as { configStore: { current: { briefs: Record<string, boolean> } } }).configStore.current.briefs.p1 = true
    expect(briefOn(on, 'p1')).toBe(true)
    const off = context('builtin', [])
    ;(off as { configStore: { current: { briefs: Record<string, boolean> } } }).configStore.current.briefs.p1 = false
    expect(briefOn(off, 'p1')).toBe(false)
  })
})
