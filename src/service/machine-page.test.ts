import { describe, expect, it, vi } from 'vitest'
import type { AccountView } from '../account/model.js'
import type { MachineRecord } from '../link/hub-store.js'
import { API_VERSION } from '../link/protocol.js'
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
    paletteColors: () => ({ own: '#6f8f7f', srv: '#a08060' }),
    taken: () => [],
    tooLarge: () => undefined,
    setCapacity: vi.fn(async () => {}),
    setColor: vi.fn(async () => {}),
    ownIdentity: vi.fn(async () => {}),
    setGitIdentity: vi.fn(async () => {}),
    log: () => {},
    ...patch,
  }
}

describe('the page of a machine (BTN-1272)', () => {
  it('shows a machine elsewhere: its report, capacity, colour, pool with its packages, accounts with limits and live sessions', async () => {
    const page = await machinePageControl(deps()).view('srv')
    expect(page).toMatchObject({ id: 'srv', own: false, online: true, about: ABOUT, capacity: 2, color: '#123456', picked: true, paletteColor: '#a08060', missing: ['codex'] })
    expect(page.projects).toEqual([{ project: 'p1', folder: '/home/example/projects/p1', enabled: true, packagesBlocked: true, packagesPause: null }])
    expect(page.accounts).toEqual([expect.objectContaining({ key: 'main', email: 'john.doe@example.com', signedIn: true, limits: expect.objectContaining({ fiveHour: expect.objectContaining({ usedPercentage: 40 }) }) })])
    expect(page.sessions.map((each) => each.task)).toEqual(['ABC-1'])
  })

  it("shows the own machine on the link, with `parallel` as its capacity, its report read here and the palette's colour", async () => {
    const page = await machinePageControl(deps()).view('own')
    expect(page).toMatchObject({ own: true, online: true, capacity: 3, color: '#6f8f7f', picked: false, paletteColor: '#6f8f7f', about: { host: 'own-host' } })
  })

  it("takes the CLIs from the machine's live panel over its handshake's report: one installed after it connected shows (BTN-1502)", async () => {
    const live = { ...facts, panel: { ...panel, clis: { claude: '2.1.330', codex: null } } } as unknown as MachineFacts
    const page = await machinePageControl(deps({ mirror: () => ({ facts: () => live, page: pageReads(() => live) }) })).view('srv')
    expect(page.about?.agents).toEqual({ claude: '2.1.330', codex: null })
    expect(page.about?.host).toBe('example-host')
  })

  it('keeps the report when the panel names no CLIs, an older machine', async () => {
    const page = await machinePageControl(deps()).view('srv')
    expect(page.about?.agents).toEqual({ claude: '2.1.0' })
  })

  it("marks a machine elsewhere whose snapshot is over the link's limit, never the own one (BTN-1560)", async () => {
    const control = machinePageControl(deps({ tooLarge: () => ({ bytes: 9_000_000, since: 1 }) }))
    expect((await control.view('srv')).stateTooLarge).toEqual({ bytes: 9_000_000, since: 1 })
    expect((await control.view('own')).stateTooLarge).toBeUndefined()
    expect((await machinePageControl(deps()).view('srv')).stateTooLarge).toBeUndefined()
  })

  it('refuses a revoked or unknown machine', async () => {
    const control = machinePageControl(deps())
    await expect(control.view('gone')).rejects.toMatchObject({ notice: { code: 'machines.unknown' } })
    await expect(control.view('nope')).rejects.toMatchObject({ notice: { code: 'machines.unknown' } })
  })

  it('marks a long-token folder whose account no machine polls: its limits come only from its sessions (BTN-1266)', async () => {
    const token = (key: string, longToken: object) => ({ key, agent: 'claude', status: { loggedIn: true, email: null }, needsLogin: false, longToken })
    const tokens = {
      ...facts,
      panel: { accounts: [token('polled', {}), token('alone', {}), token('unknown', {}), token('beside', { sameAs: 'main' }), ...panel.accounts], missing: [] },
      identities: {
        polled: { account: 'uuid-polled', email: null, polls: false },
        alone: { account: 'uuid-alone', email: null, polls: false },
        main: { account: 'uuid-main', email: 'john.doe@example.com', polls: true },
      },
    } as unknown as MachineFacts
    const page = await machinePageControl(deps({
      mirror: () => ({ facts: () => tokens, page: pageReads(() => tokens) }),
      polled: (account) => account === 'uuid-polled' || account === 'uuid-main',
    })).view('srv')
    const only = Object.fromEntries(page.accounts.map((each) => [each.key, each.sessionsOnly === true]))
    expect(only).toEqual({ polled: false, alone: true, unknown: true, beside: false, main: false })
  })

  it("marks a long-token folder whose sessions tell other windows than its account's poll, not the full sign-in (BTN-1267)", async () => {
    const tokens = {
      ...facts,
      panel: { accounts: [{ key: 'token', agent: 'claude', status: { loggedIn: true, email: null }, needsLogin: false, longToken: {} }, ...panel.accounts], missing: [] },
      identities: {
        token: { account: 'uuid-main', email: null, polls: false },
        main: { account: 'uuid-main', email: 'john.doe@example.com', polls: true },
      },
    } as unknown as MachineFacts
    const page = await machinePageControl(deps({
      mirror: () => ({ facts: () => tokens, page: pageReads(() => tokens) }),
      polled: () => true,
      differs: (account) => account === 'uuid-main',
    })).view('srv')
    expect(Object.fromEntries(page.accounts.map((each) => [each.key, each.limitsDiffer === true]))).toEqual({ token: true, main: false })
  })

  it('marks a folder on a key or a cloud: its sign-in is no browser one (BTN-1585)', async () => {
    const folders = {
      ...facts,
      panel: {
        accounts: [
          { key: 'key', agent: 'codex', status: { loggedIn: false, email: null }, needsLogin: true, apiKey: true, keyReplaceable: true },
          { key: 'cloud', agent: 'claude', status: { loggedIn: false, email: null }, needsLogin: true, apiKey: false, cloud: { cloud: 'bedrock' } },
          { key: 'bare', agent: 'codex', status: { loggedIn: false, email: null }, needsLogin: true, apiKey: false },
          ...panel.accounts,
        ],
        missing: [],
      },
    } as unknown as MachineFacts
    const page = await machinePageControl(deps({ mirror: () => ({ facts: () => folders, page: pageReads(() => folders) }) })).view('srv')
    expect(Object.fromEntries(page.accounts.map((each) => [each.key, each.paysPerToken === true]))).toEqual({ key: true, cloud: true, bare: false, main: false })
    // The key it keeps can be replaced from the hub (BTN-1684); a cloud's credentials cannot.
    expect(Object.fromEntries(page.accounts.map((each) => [each.key, each.keyReplaceable === true]))).toEqual({ key: true, cloud: false, bare: false, main: false })
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

  it("writes the own machine's git name and e-mail as the hub's own and a machine elsewhere's over the link (BTN-1503)", async () => {
    const all = deps({ ownIdentity: vi.fn(async () => {}), setGitIdentity: vi.fn(async () => {}) })
    const control = machinePageControl(all)
    await control.gitIdentity('own', 'John Doe', 'john@example.com')
    expect(all.ownIdentity).toHaveBeenCalledWith('John Doe', 'john@example.com')
    expect(all.setGitIdentity).not.toHaveBeenCalled()
    await control.gitIdentity('srv', 'Jane Doe', 'jane@example.com')
    expect(all.setGitIdentity).toHaveBeenCalledWith('srv', 'Jane Doe', 'jane@example.com')
    await expect(control.gitIdentity('gone', 'John Doe', 'john@example.com')).rejects.toMatchObject({ notice: { code: 'machines.unknown' } })
  })
})

describe("a machine's build beside the hub's (BTN-1609)", () => {
  const HUB_COMMIT = 'c0ffee0000000000000000000000000000000000'
  const OLD = 'beef000000000000000000000000000000000000'
  const built = (about: MachineAbout, patch: Partial<MachinePageDeps> = {}) => {
    const updates = { update: vi.fn(async () => {}), moving: vi.fn((): string | undefined => undefined) }
    const all = deps({ record: async (machine) => (machine === 'own' ? record('own', { about: null }) : record(machine, { about })), hubBuild: { evenKeel: '0.4.0', commit: HUB_COMMIT }, updates, ...patch })
    return { control: machinePageControl(all), updates }
  }

  it('names no gap for a machine at the hub\'s commit, nor for the own machine', async () => {
    const { control } = built({ ...ABOUT, commit: HUB_COMMIT, api: API_VERSION })
    expect((await control.view('srv')).build).toBeUndefined()
    expect((await control.view('own')).build).toBeUndefined()
  })

  it('offers "Update" to an online checkout at another commit on the same protocol, and names the target it moves to', async () => {
    const { control, updates } = built({ ...ABOUT, commit: OLD, api: API_VERSION })
    expect((await control.view('srv')).build).toEqual({ gap: 'build', hub: { evenKeel: '0.4.0', commit: HUB_COMMIT }, hubApi: API_VERSION, update: true })
    updates.moving.mockReturnValue(HUB_COMMIT)
    expect((await control.view('srv')).build?.moving).toBe(HUB_COMMIT)
    await control.update('srv')
    expect(updates.update).toHaveBeenCalledWith('srv', expect.objectContaining({ commit: OLD }))
  })

  it('offers nothing to a machine of another protocol, off the link or in a container', async () => {
    const other = built({ ...ABOUT, commit: OLD, api: API_VERSION + 1 })
    expect((await other.control.view('srv')).build).toMatchObject({ gap: 'protocol', update: false })
    const away = built({ ...ABOUT, commit: OLD, api: API_VERSION }, { online: () => false })
    expect((await away.control.view('srv')).build).toMatchObject({ gap: 'build', update: false })
    await expect(away.control.update('srv')).rejects.toMatchObject({ notice: { code: 'machines.offline' } })
    expect(away.updates.update).not.toHaveBeenCalled()
    const boxed = built({ ...ABOUT, evenKeel: '0.3.9', container: true, api: API_VERSION })
    expect((await boxed.control.view('srv')).build).toMatchObject({ gap: 'build', update: false })
  })

  it('refuses "Update" of the own machine', async () => {
    const { control, updates } = built({ ...ABOUT, commit: OLD, api: API_VERSION })
    await expect(control.update('own')).rejects.toMatchObject({ notice: { code: 'machines.noUpdate' } })
    expect(updates.update).not.toHaveBeenCalled()
  })
})

describe("a machine's folders bound to other projects' memory (BTN-1648)", () => {
  const bound = (patch: Partial<NonNullable<MachinePageDeps['memory']>> = {}) => {
    const memory = {
      of: (machine: string) => (machine === 'srv' ? [{ project: 'p2', folder: '/home/example/p2' }] : []),
      projects: () => ['p1', 'p2'],
      set: vi.fn(async () => {}),
      ...patch,
    }
    return { memory, control: machinePageControl(deps({ memory })) }
  }

  it("shows a machine elsewhere's bindings, and none for the own machine, whose folders are the hub's copies", async () => {
    const { control } = bound()
    expect((await control.view('srv')).memory).toEqual([{ project: 'p2', folder: '/home/example/p2' }])
    expect((await control.view('own')).memory).toBeUndefined()
  })

  it('saves the bindings trimmed, once each', async () => {
    const { control, memory } = bound()
    await control.memoryFolders('srv', [{ project: 'p2', folder: ' /home/example/p2 ' }, { project: 'p2', folder: '/home/example/p2' }, { project: 'p1', folder: '/home/example/p1-copy' }])
    expect(memory.set).toHaveBeenCalledWith('srv', [{ project: 'p2', folder: '/home/example/p2' }, { project: 'p1', folder: '/home/example/p1-copy' }])
  })

  it('refuses the own machine, a revoked one, a project not here and an empty folder', async () => {
    const { control, memory } = bound()
    await expect(control.memoryFolders('own', [])).rejects.toMatchObject({ notice: { code: 'machines.memoryOwn' } })
    await expect(control.memoryFolders('gone', [])).rejects.toMatchObject({ notice: { code: 'machines.unknown' } })
    await expect(control.memoryFolders('srv', [{ project: 'p9', folder: '/x' }])).rejects.toMatchObject({ notice: { code: 'machines.unknownProject' } })
    await expect(control.memoryFolders('srv', [{ project: 'p1', folder: '  ' }])).rejects.toMatchObject({ notice: { code: 'request.required', params: { field: 'folder' } } })
    expect(memory.set).not.toHaveBeenCalled()
  })
})
