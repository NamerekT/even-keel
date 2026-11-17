import { describe, expect, it, vi } from 'vitest'
import type { AccountView } from '../account/model.js'
import type { MachineRecord } from '../link/hub-store.js'
import type { MachineAbout } from '../link/view.js'
import type { MachineFacts } from '../machine/facts.js'
import { pageReads } from '../machine/page.js'
import type { SessionView } from '../state.js'
import { machinePageControl, type MachinePageDeps } from './machine-page.js'

const ABOUT: MachineAbout = { host: 'example-host', os: 'linux 6.8.0', evenKeel: '0.4.0', node: '24.11.0', git: '2.47.0', agents: { claude: '2.1.0' }, gitUser: true, root: '/home/example/projects' }

const record = (id: string, patch: Partial<MachineRecord> = {}): MachineRecord => ({
  id, name: id, secretHash: '', createdAt: 0, revokedAt: null, host: null, lastEvent: 0, inviteExpires: null, joinedAt: 1, about: ABOUT, capacity: 1, color: null, ...patch,
})

const session = (task: string, lamp: SessionView['lamp']) => ({ task, sessionId: `s-${task}`, agent: 'claude', model: 'opus', lamp, cwd: `/work/${task}` }) as SessionView

const panel = {
  accounts: [{ key: 'main', agent: 'claude', status: { loggedIn: true, email: 'john.doe@example.com' }, needsLogin: false }],
  missing: ['codex'],
} as unknown as AccountView

const facts = {
  sessions: { a: session('ABC-1', 'working'), b: session('ABC-0', 'finished') },
  panel,
  limits: { main: { fiveHour: { usedPercentage: 40, resetsAt: '2026-11-17T18:40:00.000Z' }, sevenDay: null, updatedAt: '2026-11-17T15:00:00.000Z', source: 'usage' } },
  projects: { p1: { packagesBlocked: true, run: {}, tasks: {}, reported: {} } },
} as unknown as MachineFacts

function deps(patch: Partial<MachinePageDeps> = {}): MachinePageDeps {
  const records = { own: record('own', { about: null, joinedAt: null }), srv: record('srv', { capacity: 2, color: '#123456' }), gone: record('gone', { revokedAt: 5 }) }
  return {
    own: () => 'own',
    record: async (machine) => records[machine as keyof typeof records],
    online: (machine) => machine === 'srv',
    mirror: () => ({ facts: () => facts, page: pageReads(() => facts) }),
    ownAbout: async () => ({ ...ABOUT, host: 'own-host', root: null }),
    parallel: () => 3,
    setParallel: vi.fn(),
    folders: async () => [{ project: 'p1', folder: '/home/example/projects/p1', enabled: true }],
    colors: () => ({ own: '#6f8f7f', srv: '#123456' }),
    taken: () => [],
    setCapacity: vi.fn(async () => {}),
    setColor: vi.fn(async () => {}),
    log: () => {},
    ...patch,
  }
}

describe('the page of a machine (BTN-1272)', () => {
  it('shows a machine elsewhere: its report, capacity, colour, pool with its packages, accounts with limits and live sessions', async () => {
    const page = await machinePageControl(deps()).view('srv')
    expect(page).toMatchObject({ id: 'srv', own: false, online: true, about: ABOUT, capacity: 2, color: '#123456', picked: true, missing: ['codex'] })
    expect(page.projects).toEqual([{ project: 'p1', folder: '/home/example/projects/p1', enabled: true, packagesBlocked: true, packagesPause: null }])
    expect(page.accounts).toEqual([expect.objectContaining({ key: 'main', email: 'john.doe@example.com', signedIn: true, limits: expect.objectContaining({ fiveHour: expect.objectContaining({ usedPercentage: 40 }) }) })])
    expect(page.sessions.map((each) => each.task)).toEqual(['ABC-1'])
  })

  it("shows the own machine on the link, with `parallel` as its capacity, its report read here and the palette's colour", async () => {
    const page = await machinePageControl(deps()).view('own')
    expect(page).toMatchObject({ own: true, online: true, capacity: 3, color: '#6f8f7f', picked: false, about: { host: 'own-host' } })
  })

  it('refuses a revoked or unknown machine', async () => {
    const control = machinePageControl(deps())
    await expect(control.view('gone')).rejects.toMatchObject({ notice: { code: 'machines.unknown' } })
    await expect(control.view('nope')).rejects.toMatchObject({ notice: { code: 'machines.unknown' } })
  })

  it("writes the own machine's capacity into `parallel` and a machine elsewhere's into its row", async () => {
    const all = deps()
    const control = machinePageControl(all)
    await control.capacity('own', 4)
    expect(all.setParallel).toHaveBeenCalledWith(4)
    await control.capacity('srv', 2)
    expect(all.setCapacity).toHaveBeenCalledWith('srv', 2)
    await expect(control.capacity('srv', 0)).rejects.toMatchObject({ notice: { code: 'request.required' } })
  })
})
