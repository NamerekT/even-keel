import { describe, expect, it } from 'vitest'
import { API_VERSION } from '../link/protocol.js'
import type { HubBuild, MachineAbout } from '../link/view.js'
import type { Notice } from '../notice/notice.js'
import { buildGap, followTarget, MachineUpdates, type MachineUpdatesOptions } from './machine-updates.js'

const HUB_COMMIT = 'c0ffee0000000000000000000000000000000000'
const OLD = 'beef000000000000000000000000000000000000'
const HUB: HubBuild = { evenKeel: '0.4.0', commit: HUB_COMMIT }
const ABOUT: MachineAbout = { host: 'example-host', os: 'linux 6.8.0', evenKeel: '0.4.0', node: '24.1.0', git: '2.45.0', agents: {}, gitUser: true, root: '/repos', commit: OLD, api: API_VERSION }

describe('buildGap', () => {
  it('names another API a protocol gap, whatever the version says', () => {
    expect(buildGap(HUB, { ...ABOUT, commit: HUB_COMMIT, api: API_VERSION - 1 })).toBe('protocol')
  })

  it('names another commit or version on the same API a build gap', () => {
    expect(buildGap(HUB, ABOUT)).toBe('build')
    const { commit: _commit, ...packaged } = ABOUT
    expect(buildGap({ evenKeel: '0.4.1' }, packaged)).toBe('build')
    // A package beside a hub from a checkout of the same version is another build too.
    expect(buildGap(HUB, packaged)).toBe('build')
  })

  it('finds no gap at the hub\'s commit, or at its version for packages', () => {
    expect(buildGap(HUB, { ...ABOUT, commit: HUB_COMMIT })).toBeNull()
    const { commit: _commit, ...packaged } = ABOUT
    expect(buildGap({ evenKeel: '0.4.0' }, packaged)).toBeNull()
    // A report kept before the field names no API: only the build is compared.
    const { api: _api, ...older } = ABOUT
    expect(buildGap(HUB, { ...older, commit: HUB_COMMIT })).toBeNull()
  })
})

describe('followTarget', () => {
  it('moves a checkout to the hub\'s commit and a package to its version', () => {
    expect(followTarget(HUB, ABOUT)).toEqual(HUB)
    const { commit: _commit, ...packaged } = ABOUT
    expect(followTarget({ evenKeel: '0.4.1' }, packaged)).toEqual({ evenKeel: '0.4.1' })
  })

  it('has nothing to move to at the same build, for a checkout beside a hub of npm, or in a container', () => {
    expect(followTarget(HUB, { ...ABOUT, commit: HUB_COMMIT })).toBeUndefined()
    expect(followTarget({ evenKeel: '0.4.1' }, ABOUT)).toBeUndefined()
    const { commit: _commit, ...packaged } = ABOUT
    expect(followTarget(HUB, packaged)).toBeUndefined()
    expect(followTarget({ evenKeel: '0.4.1' }, { ...packaged, container: true })).toBeUndefined()
  })
})

function updates(options: Partial<MachineUpdatesOptions> = {}) {
  const asks: Array<{ machine: string; build: HubBuild; force: boolean }> = []
  const notices: Array<{ notice: Notice; machine: string }> = []
  const log: string[] = []
  let busy: string[] = []
  const made = new MachineUpdates({
    hub: HUB,
    busy: () => busy,
    ask: async (machine, build, force) => {
      asks.push({ machine, build, force })
      return null
    },
    name: (machine) => `name of ${machine}`,
    notify: (notice, machine) => void notices.push({ notice, machine }),
    log: (line) => void log.push(line),
    settleMs: 30_000,
    sleep: async () => {
      busy = []
    },
    ...options,
  })
  return { made, asks, notices, log, setBusy: (projects: string[]) => (busy = projects) }
}

describe('MachineUpdates', () => {
  it('asks a machine of another build to come to the hub\'s, once per target', async () => {
    const { made, asks, log } = updates()
    await made.seen('m-1', ABOUT)
    await made.seen('m-1', ABOUT)
    expect(asks).toEqual([{ machine: 'm-1', build: HUB, force: false }])
    expect(made.moving('m-1')).toBe(HUB_COMMIT)
    expect(log.join('\n')).toContain(`machine m-1 (name of m-1) runs ${OLD}, the hub ${HUB_COMMIT}`)
  })

  it('asks nothing of a machine at the hub\'s build or of another protocol', async () => {
    const { made, asks } = updates()
    await made.seen('m-1', { ...ABOUT, commit: HUB_COMMIT })
    await made.seen('m-2', { ...ABOUT, api: API_VERSION + 1 })
    expect(asks).toEqual([])
    expect(made.moving('m-1')).toBeUndefined()
  })

  it('waits until no lane of the machine is in a launch, a handover or a closing', async () => {
    const order: string[] = []
    const harness = updates({
      ask: async () => {
        order.push('ask')
        return null
      },
      sleep: async () => {
        order.push('sleep')
        harness.setBusy([])
      },
    })
    harness.setBusy(['p-1'])
    await harness.made.seen('m-1', ABOUT)
    expect(order).toEqual(['sleep', 'ask'])
  })

  it('goes on after the settle time even with a lane still busy', async () => {
    let clock = 0
    const harness = updates({
      now: () => clock,
      sleep: async (ms) => void (clock += ms),
    })
    harness.setBusy(['p-1'])
    await harness.made.seen('m-1', ABOUT)
    expect(harness.asks).toHaveLength(1)
    expect(harness.log.join('\n')).toContain('p-1 did not settle')
  })

  it('tells what keeps the machine where it is', async () => {
    const { made, notices } = updates({ ask: async () => ({ to: HUB_COMMIT, stuck: 'dirty' }) })
    await made.seen('m-1', ABOUT)
    expect(notices.map((each) => each.notice)).toEqual([{ code: 'machines.updateDirty', params: { name: 'name of m-1', to: HUB_COMMIT.slice(0, 7) } }])
    expect(made.moving('m-1')).toBeUndefined()
  })

  it('tells once an update the machine reports failed at the hub\'s target, and asks nothing of it', async () => {
    const { made, asks, notices, log } = updates()
    const failed = { ...ABOUT, follow: { to: HUB_COMMIT, stuck: 'failed' as const } }
    await made.seen('m-1', failed)
    await made.seen('m-1', failed)
    expect(asks).toEqual([])
    expect(notices.map((each) => each.notice.code)).toEqual(['machines.updateFailed'])
    expect(log.join('\n')).toContain('failed and was rolled back')
  })

  it('tells a failed ask, the machine off the link among them', async () => {
    const { made, notices } = updates({ ask: async () => { throw new Error('the machine went off the link') } })
    await made.seen('m-1', ABOUT)
    expect(notices.map((each) => each.notice.code)).toEqual(['machines.updateFailed'])
  })

  it('updates at the person\'s ask again, a failed target too', async () => {
    const { made, asks } = updates()
    const failed = { ...ABOUT, follow: { to: HUB_COMMIT, stuck: 'failed' as const } }
    await made.seen('m-1', failed)
    await made.update('m-1', failed)
    expect(asks).toEqual([{ machine: 'm-1', build: HUB, force: true }])
  })

  it('refuses "Update" where there is nothing to move to', async () => {
    const { made } = updates()
    // At once, before any settle: the page's command answers with it.
    expect(() => made.update('m-1', { ...ABOUT, commit: HUB_COMMIT })).toThrow(expect.objectContaining({ notice: expect.objectContaining({ code: 'machines.noUpdate' }) }))
  })
})
