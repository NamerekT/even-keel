import { describe, expect, it } from 'vitest'
import type { MachineCard, MachineView } from '../../../src/state.js'
import { EMPTY_FIELDS, type WizardFields } from './projectWizard.js'
import {
  blockShown,
  hubOn,
  joinOnMachine,
  machineFolder,
  machinesDraft,
  machinesMissing,
  remoteOf,
  rowState,
  wizardMachines,
  type WizardMachine,
} from './machinePicks.js'

const fields = (change: Partial<WizardFields>): WizardFields => ({ ...EMPTY_FIELDS, target: 'https://git.example.com/acme/shop.git', ...change })

const card = (id: string, change: Partial<MachineCard> = {}): MachineCard => ({
  id, name: id, color: '#888', own: false, online: true, offlineSince: null, gitUser: true, agents: ['claude'], limitedUntil: {}, projects: [], accounts: [], active: null, ...change,
})

const view = (id: string, os: string, root: string | null): MachineView => ({
  id, name: id, createdAt: 0, revokedAt: null, inviteExpires: null, joinedAt: 1, host: id, online: true, projects: [], taken: [],
  about: { host: id, os, evenKeel: '0.4.0', node: '24', git: '2.47', agents: {}, gitUser: true, root },
})

const hub: WizardMachine = { id: 'pc', name: 'hub', color: '#888', own: true, online: true, offlineSince: null, os: 'linux', root: null, agents: ['claude'] }
const laptop: WizardMachine = { ...hub, id: 'laptop', name: 'laptop', own: false, os: 'win32 10', root: 'C:\\Users\\dev\\projects' }
const mini: WizardMachine = { ...laptop, id: 'mini', name: 'mini', os: 'linux 6.8', root: '/home/dev/projects' }
const gone: WizardMachine = { ...mini, id: 'gone', name: 'gone', online: false, offlineSince: 1 }

describe("the wizard's machines (BTN-1297)", () => {
  it('reads the hub first, each machine elsewhere with its system and folder of projects', () => {
    const machines = wizardMachines([card('mini'), card('pc', { own: true })], [view('mini', 'linux 6.8', '/home/dev/projects')], 'win32')
    expect(machines.map((each) => [each.id, each.os, each.root])).toEqual([
      ['pc', 'win32', null],
      ['mini', 'linux 6.8', '/home/dev/projects'],
    ])
  })

  it('shows the block only for a git project with a machine elsewhere', () => {
    expect(blockShown(fields({}), [hub])).toBe(false)
    expect(blockShown(fields({}), [hub, mini])).toBe(true)
    expect(blockShown(fields({ git: false }), [hub, mini])).toBe(false)
  })

  it('takes the remote from an address, or from an existing checkout that has one', () => {
    expect(remoteOf(fields({}), null)).toBe('https://git.example.com/acme/shop.git')
    const existing = fields({ target: '/home/node/shop' })
    expect(remoteOf(existing, { as: 'existing', remote: { name: 'origin', url: 'git@example.com:acme/shop.git' } })).toBe('git@example.com:acme/shop.git')
    expect(remoteOf(existing, { as: 'existing', remote: null })).toBeNull()
    expect(remoteOf(fields({ target: 'shop' }), { as: 'name' })).toBeNull()
  })

  it('opens a machine elsewhere only online, with a folder of projects, and while the project has a remote', () => {
    expect(rowState(hub, null)).toBe('open')
    expect(rowState(mini, 'https://example.com/a.git')).toBe('open')
    expect(rowState(mini, null)).toBe('noRemote')
    expect(rowState(gone, 'https://example.com/a.git')).toBe('offline')
    expect(rowState({ ...mini, root: null }, 'https://example.com/a.git')).toBe('noRoot')
  })

  it("joins a name under a machine's folder of projects in its own way of writing paths", () => {
    expect(joinOnMachine('/home/dev/projects/', 'apps/shop')).toBe('/home/dev/projects/apps/shop')
    expect(joinOnMachine('C:\\Users\\dev\\projects', 'apps/shop')).toBe('C:\\Users\\dev\\projects\\apps\\shop')
    expect(joinOnMachine('D:/Projects', 'apps\\shop')).toBe('D:/Projects/apps/shop')
  })

  it("names a machine's folder by the typed name, the hub's folder name, or another folder's full path", () => {
    expect(machineFolder({ on: true, folder: '', other: false, path: '' }, mini, 'shop')).toBe('/home/dev/projects/shop')
    expect(machineFolder({ on: true, folder: ' apps/shop ', other: false, path: '' }, mini, 'shop')).toBe('/home/dev/projects/apps/shop')
    expect(machineFolder({ on: true, folder: 'x', other: true, path: ' /srv/shop ' }, mini, 'shop')).toBe('/srv/shop')
    expect(machineFolder({ on: true, folder: '', other: true, path: '' }, mini, 'shop')).toBeNull()
    expect(machineFolder({ on: true, folder: '', other: false, path: '' }, mini, '')).toBeNull()
  })

  it('sends the ticked open machines with their folders, and the hub off only when unticked', () => {
    const machines = [hub, laptop, mini, gone]
    const picks = {
      laptop: { on: true, folder: '', other: false, path: '' },
      mini: { on: false, folder: 'kept', other: false, path: '' },
      gone: { on: true, folder: '', other: false, path: '' },
    }
    const remote = 'https://git.example.com/acme/shop.git'
    expect(machinesDraft(fields({ machines: picks }), machines, remote, 'shop')).toEqual({ machines: [{ machine: 'laptop', folder: 'C:\\Users\\dev\\projects\\shop' }] })
    expect(machinesDraft(fields({ machines: picks, hubOff: true }), machines, remote, '')).toEqual({ machines: [{ machine: 'laptop' }], here: false })
  })

  it('sends only the hub without a remote, the ticks kept for when it comes back', () => {
    const picked = fields({ machines: { mini: { on: true, folder: '', other: false, path: '' } }, hubOff: true })
    expect(machinesDraft(picked, [hub, mini], null, 'shop')).toEqual({})
    expect(hubOn(picked, null)).toBe(true)
    expect(hubOn(picked, 'https://example.com/a.git')).toBe(false)
    expect(machinesDraft(fields({}), [hub], 'https://example.com/a.git', 'shop')).toEqual({})
  })

  it('wants a machine ticked, and a ticked one with a folder that is not taken', () => {
    const remote = 'https://example.com/a.git'
    const none = fields({ hubOff: true })
    expect(machinesMissing(none, [hub, mini], remote, {})).toBe('machines')
    expect(machinesMissing(none, [hub, mini], null, {})).toBeNull()
    const on = fields({ machines: { mini: { on: true, folder: '', other: false, path: '' } } })
    expect(machinesMissing(on, [hub, mini], remote, {})).toBeNull()
    expect(machinesMissing(on, [hub, mini], remote, { mini: { state: 'taken', notice: { code: 'pool.foreignRepo', params: { folder: '/home/dev/projects/shop', remote } } } })).toBe('machineFolder')
    const blank = fields({ machines: { mini: { on: true, folder: '', other: true, path: ' ' } } })
    expect(machinesMissing(blank, [hub, mini], remote, {})).toBe('machineFolder')
  })
})
