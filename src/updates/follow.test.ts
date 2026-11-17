import { describe, expect, it } from 'vitest'
import type { VersionRefusal } from '../link/protocol.js'
import type { ServiceControl } from './control.js'
import { HubFollower, type FollowOptions } from './follow.js'
import type { Checkout, UpdateRecord } from './model.js'
import type { UpdatePlan } from './runner.js'

const HUB = 'c0ffee0000000000000000000000000000000000'
const OLD = 'beef000000000000000000000000000000000000'
const REFUSAL: VersionRefusal = { refused: 'version', api: 12, evenKeel: '0.4.0', commit: HUB }
const CONTROL: ServiceControl = { kind: 'systemd', name: 'even-keel.service', stop: ['systemctl', '--user', 'stop', 'even-keel.service'], start: ['systemctl', '--user', 'start', 'even-keel.service'] }
const CLEAN: Checkout = { commit: OLD, branch: 'dev', tags: [], dirty: false }

function follower(options: Partial<FollowOptions> = {}) {
  const plans: UpdatePlan[] = []
  const log: string[] = []
  const made = new HubFollower({
    root: '/srv/even-keel',
    home: '/srv/even-keel',
    stateDir: '/srv/even-keel/state',
    source: 'git',
    current: '0.4.0',
    control: async () => CONTROL,
    checkout: async () => CLEAN,
    record: () => null,
    launch: (plan) => void plans.push(plan),
    log: (line) => void log.push(line),
    ...options,
  })
  return { made, plans, log }
}

const failedAt = (tag: string): UpdateRecord => ({
  mode: 'follow',
  from: { version: '0.4.0', commit: OLD, branch: 'dev', tag: null, storage: null },
  to: { version: '0.4.0', tag },
  startedAt: '2026-11-17T10:00:00.000Z',
  finishedAt: '2026-11-17T10:02:00.000Z',
  failed: { step: 'build', output: 'tsc exited with code 2' },
  rollback: { failed: null },
  seen: false,
})

describe('HubFollower', () => {
  it('moves a clean checkout to the hub\'s commit, building for a machine and waiting for the hub\'s contact', async () => {
    const { made, plans } = follower()
    await made.refused(REFUSAL)
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({
      mode: 'follow',
      install: null,
      target: { version: '0.4.0', tag: HUB },
      from: { version: '0.4.0', commit: OLD, branch: 'dev' },
      service: { stop: CONTROL.stop, start: CONTROL.start },
      machine: { contact: expect.stringContaining('machine-link.json') },
    })
    expect(plans[0]?.package).toBeUndefined()
    expect(made.view()).toBeUndefined()
  })

  it('launches once, however many refusals come while the update runs', async () => {
    const { made, plans } = follower()
    await Promise.all([made.refused(REFUSAL), made.refused(REFUSAL)])
    await made.refused(REFUSAL)
    expect(plans).toHaveLength(1)
  })

  it('does not try a commit again that it failed at, and tries the hub\'s next one', async () => {
    const { made, plans, log } = follower({ record: () => failedAt(HUB) })
    await made.refused(REFUSAL)
    await made.refused(REFUSAL)
    expect(plans).toEqual([])
    expect(made.view()).toEqual({ to: HUB, stuck: 'failed' })
    expect(log.filter((line) => line.includes('failed'))).toHaveLength(1)

    const next = 'abc0000000000000000000000000000000000000'
    await made.refused({ ...REFUSAL, commit: next })
    expect(plans.map((plan) => plan.target?.tag)).toEqual([next])
  })

  it('leaves a checkout with changes in tracked files alone', async () => {
    const { made, plans } = follower({ checkout: async () => ({ ...CLEAN, dirty: true }) })
    await made.refused(REFUSAL)
    expect(plans).toEqual([])
    expect(made.view()).toEqual({ to: HUB, stuck: 'dirty' })
  })

  it('only tells what to install without a service manager or a commit to move to', async () => {
    const without = follower({ control: async () => null })
    await without.made.refused(REFUSAL)
    expect(without.plans).toEqual([])
    expect(without.made.view()).toEqual({ to: HUB, stuck: 'manual' })

    const npmHub = follower()
    await npmHub.made.refused({ refused: 'version', api: 12, evenKeel: '0.4.1' })
    expect(npmHub.plans).toEqual([])
    expect(npmHub.made.view()).toEqual({ to: '0.4.1', stuck: 'manual' })
  })

  it('installs the hub\'s version into the global prefix a package is in', async () => {
    const { made, plans } = follower({ source: 'npm', current: '0.4.0', root: '/usr/lib/node_modules/even-keel', home: '/home/example/.even-keel', platform: 'linux' })
    await made.refused({ refused: 'version', api: 12, evenKeel: '0.4.1' })
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({ mode: 'follow', package: { name: 'even-keel', prefix: '/usr' }, target: { version: '0.4.1', tag: 'v0.4.1' }, from: { version: '0.4.0' } })
  })

  it('tells to install by hand a package outside a global install, or when the hub runs the same version', async () => {
    const local = follower({ source: 'npm', root: '/home/example/app/node_modules/even-keel', platform: 'linux' })
    await local.made.refused({ refused: 'version', api: 12, evenKeel: '0.4.1' })
    expect(local.plans).toEqual([])
    expect(local.made.view()).toEqual({ to: '0.4.1', stuck: 'manual' })

    const same = follower({ source: 'npm', root: '/usr/lib/node_modules/even-keel', platform: 'linux' })
    await same.made.refused({ refused: 'version', api: 12, evenKeel: '0.4.0', commit: HUB })
    expect(same.plans).toEqual([])
    expect(same.made.view()).toEqual({ to: '0.4.0', stuck: 'manual' })
  })

  it('names a launch that did not start as a failure', async () => {
    const { made } = follower({ launch: () => { throw new Error('dist/src/updates/run.js is missing: run npm run build') } })
    await made.refused(REFUSAL)
    expect(made.view()).toEqual({ to: HUB, stuck: 'failed' })
  })
})
