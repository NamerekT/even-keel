import { describe, expect, it } from 'vitest'
import type { ActiveChain } from '../../src/chain/dispatcher.js'
import { notice } from '../../src/notice/notice.js'
import type { EvenKeelState, PackagesView, ProjectPackages } from '../../src/state.js'
import { chainWaits } from './waits.js'

const running = (patch: Partial<ActiveChain> = {}): ActiveChain => ({ project: 'ABC', current: null, paused: false, error: null, ...patch })

const packagesOf = (projects: Record<string, ProjectPackages> = {}, gateway: PackagesView['gateway'] = null) => ({ gateway, projects }) as unknown as PackagesView

const stateOf = (chain: ActiveChain | null, packages = packagesOf()) =>
  ({ chain: { active: chain === null ? [] : [chain] }, packages }) as unknown as Pick<EvenKeelState, 'chain' | 'packages'>

const held = (cells: ProjectPackages['cells']): ProjectPackages => ({ cells, problems: [], blocked: true, tracker: null })

describe('chainWaits', () => {
  it('has nothing for a chain that is not running, is paused or works a task', () => {
    expect(chainWaits(stateOf(null), 'ABC')).toEqual([])
    expect(chainWaits(stateOf(running({ paused: true, limitUntil: '2026-11-01T05:00:00.000Z' })), 'ABC')).toEqual([])
    expect(chainWaits(stateOf(running({ current: { task: 'ABC-1', sessionId: 's', since: '2026-11-01T04:00:00.000Z' } })), 'ABC')).toEqual([])
  })

  it('lists what the dispatcher keeps, in the order it checks them', () => {
    const slot = notice('slot.waiting', { task: 'ABC-2' })
    const ciWait = { commit: 'abc', since: '2026-11-01T04:00:00.000Z' }
    const limitsWait = { account: 'work', next: null }
    const chain = running({ closing: 'ABC-1', ciWait, limitsWait, limitUntil: '2026-11-01T05:00:00.000Z', slotWait: { notice: slot, at: '2026-11-01T04:00:00.000Z' } })
    expect(chainWaits(stateOf(chain), 'ABC').map((each) => each.kind)).toEqual(['closing', 'ci', 'limits', 'limit', 'slot'])
  })

  it('calls a released session in the folder of a project without git a wait for the folder, not for a slot', () => {
    const busy = notice('folder.busy', { tasks: ['ABC-9'], task: 'ABC-2' })
    const chain = running({ slotWait: { notice: busy, at: '2026-11-01T04:00:00.000Z' } })
    expect(chainWaits(stateOf(chain), 'ABC')).toEqual([{ kind: 'folder', notice: busy }])
  })

  it('names the model whose own week holds the chain, and whether its reset is known', () => {
    const chain = running({ modelWeek: { model: 'Fable', until: '2026-11-01T05:00:00.000Z' } })
    expect(chainWaits(stateOf(chain), 'ABC')).toEqual([{ kind: 'model', model: 'Fable', until: '2026-11-01T05:00:00.000Z' }])
    expect(chainWaits(stateOf(running({ modelWeek: { model: 'Fable', until: null } })), 'ABC')).toEqual([{ kind: 'model', model: 'Fable', until: null }])
  })

  it('names the packages a chain about to launch waits for, and whether they pass by themselves', () => {
    const cells: ProjectPackages['cells'] = {
      huly: { choice: null, enabled: true, own: {}, problems: [{ kind: 'installing' }, { kind: 'unsupported', agent: 'codex' }] },
      forgejo: { choice: null, enabled: true, own: {}, problems: [{ kind: 'probing' }] },
      off: { choice: 'off', enabled: false, own: {}, problems: [{ kind: 'noResponse', servers: ['x'] }] },
    }
    expect(chainWaits(stateOf(running(), packagesOf({ ABC: held(cells) })), 'ABC')).toEqual([
      { kind: 'packages', passing: true, packages: [{ name: 'huly', problems: [{ kind: 'installing' }] }, { name: 'forgejo', problems: [{ kind: 'probing' }] }] },
    ])

    const silent = { ...cells, forgejo: { ...cells.forgejo!, problems: [{ kind: 'noResponse' as const, servers: ['forgejo'] }] } }
    expect(chainWaits(stateOf(running(), packagesOf({ ABC: held(silent) })), 'ABC')).toMatchObject([{ kind: 'packages', passing: false }])
  })

  it('says the gateway rather than the packages when it does not run', () => {
    const error = notice('packages.port', { port: 4748 })
    expect(chainWaits(stateOf(running(), packagesOf({ ABC: held({}) }, error)), 'ABC')).toEqual([{ kind: 'gateway', error }])
  })

  it('leaves the packages out while a task is closing or the chain only runs a fix', () => {
    const packages = packagesOf({ ABC: held({}) }, notice('packages.port', { port: 4748 }))
    expect(chainWaits(stateOf(running({ closing: 'ABC-1' }), packages), 'ABC')).toEqual([{ kind: 'closing', task: 'ABC-1' }])
    expect(chainWaits(stateOf(running({ fixOnly: true }), packages), 'ABC')).toEqual([])
  })
})
