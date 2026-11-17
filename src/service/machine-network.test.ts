import { PGlite } from '@electric-sql/pglite'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { MACHINE_PALETTE } from '../link/colors.js'
import { DatabaseHubStore } from '../link/hub-store.js'
import { hubIdentity } from '../link/identity.js'
import { MemoryMachineStore } from '../link/link.fixture.js'
import { MachineEnd } from '../link/machine.js'
import { httpsTransport, joinHub } from '../link/machine-transport.js'
import { ASSIGN_COMMAND, isRefusal, parseToken, type MachineAbout, type NumberedCommand } from '../link/protocol.js'
import { LIMITS_PLAN_COMMAND } from '../limits/polls.js'
import { BRIEF_COMMAND, type HubBrief } from '../machine/brief.js'
import { SELECTION_EVENT } from '../machine/config.js'
import { CLONE_PROGRESS_EVENT } from '../machine/services.js'
import { DONE_EVENT, type FactsSnapshot } from '../machine/runner.js'
import { ABC, fixture } from '../storage/database.fixture.js'
import { KEPT_WRITE_EVENT, type KeptWrite } from '../taskmcp/machine.js'
import { folderUnder, MachineNetwork, type NetworkPeers } from './machine-network.js'

const OWN = '88888888-8888-4888-8888-888888888888'
const ABOUT: MachineAbout = { host: 'example-laptop', os: 'linux 6.8.0', evenKeel: '0.4.0', node: '24.11.0', git: '2.47.0', agents: {}, gitUser: true, root: '/home/example/projects' }

const until = async (holds: () => boolean, what: string) => {
  for (let waited = 0; !holds(); waited += 10) {
    if (waited > 10_000) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const freePort = () => new Promise<number>((resolve) => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address() as { port: number }
    probe.close(() => resolve(port))
  })
})

describe("the hub's door for machines", { timeout: 60_000 }, () => {
  const closing: Array<() => Promise<void>> = []
  afterEach(async () => {
    for (const close of closing.splice(0).reverse()) await close()
  })

  const started = async (peers?: NetworkPeers, log: (line: string) => void = () => {}, takeOverOwn?: (project: string, owner: string) => Promise<void>) => {
    const db = await PGlite.create()
    await db.exec(fixture(59))
    const settings = { address: null as string | null }
    const changes: number[] = []
    const network = new MachineNetwork({
      ...(peers === undefined ? {} : { peers }),
      ...(takeOverOwn === undefined ? {} : { takeOverOwn }),
      db,
      store: new DatabaseHubStore(db),
      certificate: () => hubIdentity(db),
      own: () => OWN,
      address: () => settings.address,
      saveAddress: (address) => void (settings.address = address),
      port: await freePort(),
      repoOf: (project) => (project === ABC ? 'D:\\repos\\example' : undefined),
      allowedHosts: () => ['box.example.com'],
      serviceHost: '0.0.0.0',
      version: '0.4.0',
      changed: () => void changes.push(1),
      hubAccount: (key) => (key === 'hub-folder' ? { account: 'uuid-1', email: 'john.doe@example.com' } : undefined),
      log,
    })
    closing.push(async () => {
      await network.close()
      await db.close()
    })
    return { db, network, settings, changes }
  }

  it('names a project folder inside the machine folder of projects the way the machine writes paths', () => {
    expect(folderUnder('/home/example/projects', 'D:\\repos\\example')).toBe('/home/example/projects/example')
    expect(folderUnder('C:\\projects', '/srv/repos/example/')).toBe('C:\\projects\\example')
  })

  it('listens only while the address is set, and a machine joins, reports itself and gets a project inside its root', async () => {
    const { db, network, settings } = await started()
    await expect(network.invite('Example laptop')).rejects.toThrow(/Hub address for machines/)
    expect(network.addresses()).toContainEqual({ address: 'box.example.com', from: 'allowedHosts' })
    expect(network.addresses().some((choice) => choice.address.startsWith('127.') || choice.from === 'service')).toBe(false)

    settings.address = '127.0.0.1'
    await network.apply()
    const invite = await network.invite('Example laptop')
    const string = parseToken(invite.line)!
    expect(new URL(string.hub).hostname).toBe('127.0.0.1')
    expect(invite.command).toBe(`npx even-keel@0.4.0 install --machine ${invite.line}`)
    const joined = await joinHub(string, ABOUT, 5_000)
    if (isRefusal(joined)) throw new Error(`refused: ${joined.refused}`)

    const listed = await network.list()
    expect(listed.map((machine) => machine.id)).not.toContain(OWN)
    expect(listed.find((machine) => machine.id === string.machine)).toMatchObject({ name: 'Example laptop', about: ABOUT, inviteExpires: null, online: false, projects: [] })

    await expect(network.attach(OWN, [ABC])).rejects.toThrow(/no such machine/)
    await expect(network.attach(string.machine, ['no-such-project'])).rejects.toThrow(/no such project/)
    await network.attach(string.machine, [ABC])
    expect((await network.list()).find((machine) => machine.id === string.machine)?.projects).toEqual([ABC])
    const { rows } = await db.query<{ command: string }>('select command from machine_commands where machine_id = $1', [string.machine])
    expect(rows.map((row) => JSON.parse(row.command))).toEqual([{ type: ASSIGN_COMMAND, project: ABC, folder: '/home/example/projects/example' }])

    const pending = parseToken((await network.invite('Pending')).line)!
    await expect(network.attach(pending.machine, [ABC])).rejects.toThrow(/has not joined yet/)
    await network.revoke(string.machine)
    expect((await network.list()).find((machine) => machine.id === string.machine)?.revokedAt).not.toBeNull()

    settings.address = null
    await network.apply()
    await expect(joinHub(pending, ABOUT, 2_000)).rejects.toThrow()
  })

  it("gives each machine its own colour or the palette's, and names the folders of its pool (BTN-1272)", async () => {
    const LAPTOP = '99999999-9999-4999-8999-999999999999'
    const { network } = await started()
    await network.refresh()
    expect(network.colors()).toEqual({ [OWN]: '#6f8f7f', [LAPTOP]: MACHINE_PALETTE[1] })
    await network.setColor(LAPTOP, ' #8A8F5C ')
    await network.setColor(OWN, '#123456')
    expect(network.colors()).toEqual({ [OWN]: '#123456', [LAPTOP]: '#8a8f5c' })
    await network.setColor(OWN, null)
    expect(network.colors()[OWN]).toBe(MACHINE_PALETTE[0])
    await expect(network.setColor(LAPTOP, 'teal')).rejects.toMatchObject({ notice: { code: 'request.required' } })

    expect(await network.foldersOf(OWN)).toEqual([{ project: ABC, folder: 'D:\\repos\\example', enabled: true }])
    expect(await network.foldersOf(LAPTOP)).toEqual([{ project: ABC, folder: '/home/example/work/abc', enabled: false }])
  })

  it("keeps the address the window issues a string with, and names a machine issued without a name by its host at the join", async () => {
    const { network, settings } = await started()
    const invite = await network.invite('  ', '127.0.0.1')
    expect(settings.address).toBe('127.0.0.1')
    const string = parseToken(invite.line)!
    expect(new URL(string.hub).hostname).toBe('127.0.0.1')
    expect((await network.list()).find((machine) => machine.id === string.machine)?.name).toBe('')
    const joined = await joinHub(string, ABOUT, 5_000)
    if (isRefusal(joined)) throw new Error(`refused: ${joined.refused}`)
    expect((await network.list()).find((machine) => machine.id === string.machine)?.name).toBe('example-laptop')

    const named = parseToken((await network.invite('Example desktop', '127.0.0.1')).line)!
    await joinHub(named, ABOUT, 5_000)
    expect((await network.list()).find((machine) => machine.id === named.machine)?.name).toBe('Example desktop')
  })

  it('gives the machine the colour the window picked with its string', async () => {
    const { network } = await started()
    await expect(network.invite('Example desktop', '127.0.0.1', 'teal')).rejects.toThrow()
    const invite = await network.invite('Example desktop', '127.0.0.1', '#A08060')
    expect(network.colors()[invite.machine]).toBe('#a08060')
  })

  it('shows a folder another machine holds, frees the mark of a machine it revoked, and takes a folder over only from the machine shown', async () => {
    const owned: [string, string][] = []
    const { db, network, settings } = await started(undefined, () => {}, async (project, owner) => void owned.push([project, owner]))
    settings.address = '127.0.0.1'
    await network.apply()
    const join = async (name: string) => {
      const joined = await joinHub(parseToken((await network.invite(name)).line)!, ABOUT, 5_000)
      if (isRefusal(joined)) throw new Error(`refused: ${joined.refused}`)
      return joined.machine
    }
    const laptop = await join('Example laptop')
    const desktop = await join('Example desktop')
    await network.attach(laptop, [ABC])

    expect(await network.holds(laptop, ABC, { machine: desktop, name: 'desktop-host' })).toBe(false)
    expect(await network.holds(laptop, 'project-2', { machine: 'machine-elsewhere', name: 'other-host' })).toBe(false)
    expect((await network.list()).find((machine) => machine.id === laptop)?.taken).toEqual([
      { project: ABC, machine: desktop, name: 'Example desktop' },
      { project: 'project-2', machine: 'machine-elsewhere', name: 'other-host' },
    ])

    await expect(network.takeOver(laptop, ABC, 'machine-elsewhere')).rejects.toThrow(/nothing to take over/)
    await network.takeOver(laptop, ABC, desktop)
    const { rows } = await db.query<{ command: string }>('select command from machine_commands where machine_id = $1 order by seq', [laptop])
    expect(JSON.parse(rows.at(-1)!.command)).toEqual({ type: ASSIGN_COMMAND, project: ABC, folder: '/home/example/projects/example', payload: { takeOver: desktop } })
    expect((await network.list()).find((machine) => machine.id === laptop)?.taken.map((taken) => taken.project)).toEqual(['project-2'])
    await expect(network.takeOver(laptop, ABC, desktop)).rejects.toThrow(/nothing to take over/)

    await network.revoke(desktop)
    expect(await network.holds(laptop, ABC, { machine: desktop, name: 'desktop-host' })).toBe(true)
    expect(await network.holds(OWN, ABC, { machine: laptop, name: 'laptop-host' })).toBe(false)
    await network.takeOver(OWN, ABC, laptop)
    expect(owned).toEqual([[ABC, laptop]])
  })

  it("keeps a machine elsewhere in its own mirror, briefs it on its pool's folders and carries its limits, writes and choices", async () => {
    const briefed: Record<string, string>[] = []
    const connected: string[] = []
    const writes: [string, KeptWrite][] = []
    const lines: string[] = []
    let steered = 0
    const peers: NetworkPeers = {
      remote: () => ({ projectOf: () => undefined, projectOfSession: () => undefined, lastSession: () => undefined, saveSnapshot: () => {}, log: (line) => lines.push(line) }),
      brief: (folders) => {
        briefed.push(folders)
        return { config: { projects: folders } } as unknown as HubBrief
      },
      changed: () => void (steered += 1),
      connected: (machine) => void connected.push(machine),
      mcp: () => Promise.resolve({ status: 200, headers: {}, body: '' }),
      hook: () => Promise.resolve({ status: 200, body: '' }),
      write: async (machine, write) => void writes.push([machine, write]),
    }
    const { network, settings } = await started(peers, (line) => lines.push(line))
    settings.address = '127.0.0.1'
    await network.apply()
    const joined = await joinHub(parseToken((await network.invite('Example laptop')).line)!, ABOUT, 5_000)
    if (isRefusal(joined)) throw new Error(`refused: ${joined.refused}`)
    await network.attach(joined.machine, [ABC])

    const ran: NumberedCommand[] = []
    const snapshot: FactsSnapshot = {
      boot: 'boot-1',
      rev: 1,
      facts: {
        sessionsRead: false, accountsRead: true, tasks: {}, projects: {}, ledger: {}, resets: {},
        limits: { '/home/example/.claude': null },
        identities: { '/home/example/.claude': { account: 'account-1', email: 'john.doe@example.com', polls: true } },
      } as unknown as FactsSnapshot['facts'],
    }
    const end: MachineEnd = new MachineEnd({
      transport: httpsTransport(joined, { log: () => {}, timeoutMs: 5_000 }),
      store: new MemoryMachineStore(),
      snapshot: () => snapshot,
      command: async (command) => {
        ran.push(command)
        if (command.type !== ASSIGN_COMMAND) await end.emit(DONE_EVENT, { seq: command.seq, value: null })
      },
      log: () => {},
    })
    closing.push(async () => end.stop())
    await end.start()

    await until(() => ran.some((command) => command.type === BRIEF_COMMAND), 'the brief')
    expect(briefed.at(-1)).toEqual({ [ABC]: '/home/example/projects/example' })
    expect(connected).toEqual([joined.machine])
    expect(steered).toBeGreaterThan(0)
    expect(network.remote(OWN)).toBeUndefined()
    expect(network.remote(joined.machine)?.facts()?.accountsRead).toBe(true)
    expect(network.accounts()).toEqual([{ machine: joined.machine, online: true, identities: snapshot.facts.identities, limits: snapshot.facts.limits }])

    await network.tellLimits(joined.machine, { skip: [] })
    expect(ran.find((command) => command.type === LIMITS_PLAN_COMMAND)?.payload).toEqual({ skip: [] })
    await expect(network.tellLimits(OWN, { skip: [] })).rejects.toThrow(/no mirror/)

    // An unchanged brief is not sent again.
    const briefs = ran.filter((command) => command.type === BRIEF_COMMAND).length
    await network.catchUp()
    expect(ran.filter((command) => command.type === BRIEF_COMMAND)).toHaveLength(briefs)

    const write: KeptWrite = { path: `/tasks/${ABC}`, message: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'task_comment' } } as KeptWrite['message'] }
    await end.emit(KEPT_WRITE_EVENT, write)
    await end.emit(SELECTION_EVENT, { kind: 'cli', provider: 'claude', value: 'system' })
    await end.flushed()
    await until(() => lines.some((line) => line.includes('chose cli system for claude')), 'the choice logged')
    expect(writes).toEqual([[joined.machine, write]])
  })

  it("puts a machine into a project's pool turned off in a folder of its own, checks it there and turns it on", async () => {
    const briefed: Record<string, string>[] = []
    const peers: NetworkPeers = {
      remote: () => ({ projectOf: () => undefined, projectOfSession: () => undefined, lastSession: () => undefined, saveSnapshot: () => {}, log: () => {} }),
      brief: (folders) => {
        briefed.push({ ...folders })
        return { config: { projects: folders } } as unknown as HubBrief
      },
      changed: () => {},
      connected: () => {},
      mcp: () => Promise.resolve({ status: 200, headers: {}, body: '' }),
      hook: () => Promise.resolve({ status: 200, body: '' }),
      write: async () => {},
    }
    const { db, network, settings } = await started(peers)
    settings.address = '127.0.0.1'
    await network.apply()
    const joined = await joinHub(parseToken((await network.invite('Example laptop')).line)!, ABOUT, 5_000)
    if (isRefusal(joined)) throw new Error(`refused: ${joined.refused}`)
    const laptop = joined.machine
    const pending = parseToken((await network.invite('Pending')).line)!.machine

    // The sample's machine that never joined is left out; the own one shows the project's repository.
    expect(await network.pool(ABC)).toEqual({
      machines: [{ id: OWN, name: 'Example server', own: true, online: true, folder: 'D:\\repos\\example', enabled: true }],
      others: [{ id: laptop, name: 'Example laptop', own: false, online: false, folder: '/home/example/projects/example' }],
    })
    await expect(network.target(OWN)).rejects.toThrow(/hub's own machine/)
    await expect(network.target(pending)).rejects.toThrow(/has not joined yet/)
    const target = await network.target(laptop)
    expect(target).toEqual({ id: laptop, name: 'Example laptop', root: '/home/example/projects' })
    expect(() => network.folders(target)).toThrow(/not connected to the hub now/)

    await expect(network.place(target, ABC, '/srv/elsewhere/abc')).rejects.toThrow(/outside the machine's folder of projects/)
    expect(await network.place(target, ABC, '/home/example/projects/abc-work')).toBe(true)
    expect(await network.place(target, ABC, '/home/example/projects/abc-work')).toBe(false)
    const { rows } = await db.query<{ command: string }>('select command from machine_commands where machine_id = $1 order by seq', [laptop])
    expect(JSON.parse(rows.at(-1)!.command)).toEqual({ type: ASSIGN_COMMAND, project: ABC, folder: '/home/example/projects/abc-work' })
    expect((await network.pool(ABC)).machines.find((machine) => machine.id === laptop)).toMatchObject({ folder: '/home/example/projects/abc-work', enabled: false })
    expect(network.poolOf(ABC)).toEqual([OWN])

    const ran: NumberedCommand[] = []
    const store = new MemoryMachineStore()
    store.rootFolder = '/home/example/projects'
    const end: MachineEnd = new MachineEnd({
      transport: httpsTransport(joined, { log: () => {}, timeoutMs: 5_000 }),
      store,
      snapshot: () => ({ boot: 'boot-1', rev: 1, facts: { sessionsRead: true, accountsRead: true, tasks: {}, projects: {}, ledger: {}, resets: {}, limits: {} } as unknown as FactsSnapshot['facts'] }),
      command: async (command) => {
        ran.push(command)
        if (command.type === 'folders.clone') await end.emit(CLONE_PROGRESS_EVENT, { project: ABC, folder: command.folder, progress: { stage: 'receiving', percent: 40 } })
        if (command.type === 'folders.check') await end.emit(DONE_EVENT, { seq: command.seq, value: { code: 'pool.noPush', params: { remote: 'https://forge.example.com/abc' } } })
        else if (command.type !== ASSIGN_COMMAND) await end.emit(DONE_EVENT, { seq: command.seq, value: null })
      },
      log: () => {},
    })
    closing.push(async () => end.stop())
    await end.start()
    // A machine turned off is still briefed on the project, in its own folder: its packages install before the checks.
    await until(() => briefed.some((folders) => folders[ABC] === '/home/example/projects/abc-work'), 'the brief of the folder')

    const shown: unknown[] = []
    const stop = network.watchClone(laptop, ABC, (progress) => shown.push(progress))
    const spec = { project: ABC, folder: '/home/example/projects/abc-work', remotes: [], branch: 'main', claude: false }
    await network.folders(target).clone(spec, 'https://forge.example.com/abc.git')
    await until(() => shown.length > 0, 'the progress of the clone')
    stop()
    expect(shown).toEqual([{ stage: 'receiving', percent: 40 }])
    expect(await network.folders(target).check('push', spec)).toEqual({ code: 'pool.noPush', params: { remote: 'https://forge.example.com/abc' } })

    await expect(network.setEnabled(ABC, pending, true)).rejects.toThrow(/not in this project's pool/)
    await network.setEnabled(ABC, laptop, true)
    await network.setEnabled(ABC, OWN, false)
    expect(network.poolOf(ABC)).toEqual([laptop])
    await network.unplace(laptop, ABC)
    expect(network.poolOf(ABC)).toEqual([])
    expect((await network.pool(ABC)).others.map((machine) => machine.id)).toEqual([laptop])
  })

  it("shows a machine's accounts and its sign-in, and starts the sign-in, its code and its cancel on that machine", async () => {
    let republished = 0
    const peers: NetworkPeers = {
      remote: () => ({ projectOf: () => undefined, projectOfSession: () => undefined, lastSession: () => undefined, saveSnapshot: () => {}, log: () => {} }),
      brief: () => ({ config: { projects: {} } }) as unknown as HubBrief,
      changed: () => void (republished += 1),
      connected: () => {},
      mcp: () => Promise.resolve({ status: 200, headers: {}, body: '' }),
      hook: () => Promise.resolve({ status: 200, body: '' }),
      write: async () => {},
    }
    const lines: string[] = []
    const { network, settings } = await started(peers, (line) => void lines.push(line))
    settings.address = '127.0.0.1'
    await network.apply()
    const joined = await joinHub(parseToken((await network.invite('Example laptop')).line)!, ABOUT, 5_000)
    if (isRefusal(joined)) throw new Error(`refused: ${joined.refused}`)
    await expect(network.login(joined.machine, 'claude')).rejects.toThrow(/not connected/)

    const signedOut = { key: 'john.doe@example.com', agent: 'claude', status: { loggedIn: false, email: null }, lastEmail: 'john.doe@example.com', needsLogin: true }
    const signedIn = { key: 'codex', agent: 'codex', status: { loggedIn: true, email: 'jane.doe@example.com' }, needsLogin: false }
    const onToken = { key: 'token', agent: 'claude', status: { loggedIn: true, email: null }, needsLogin: false, longToken: { until: null, account: { account: 'uuid-2', email: 'jane.roe@example.com' } } }
    const login = { agent: 'claude', target: null, startedAt: '2026-11-17T10:00:00.000Z', urls: ['https://claude.ai/oauth/authorize?code=true'], deviceCode: null, output: 'Paste code here', error: null, codeSent: false }
    const snapshot: FactsSnapshot = {
      boot: 'boot-1',
      rev: 1,
      facts: {
        sessionsRead: true, accountsRead: true, tasks: {}, projects: {}, ledger: {}, resets: {}, limits: {},
        panel: { active: 'codex', accounts: [signedOut, signedIn, onToken], login, loginBlock: null, apps: [], pool: [], missing: ['opencode'] },
      } as unknown as FactsSnapshot['facts'],
    }
    const ran: NumberedCommand[] = []
    const end: MachineEnd = new MachineEnd({
      transport: httpsTransport(joined, { log: () => {}, timeoutMs: 5_000 }),
      store: new MemoryMachineStore(),
      snapshot: () => snapshot,
      command: async (command) => {
        ran.push(command)
        await end.emit(DONE_EVENT, { seq: command.seq, value: null })
      },
      log: () => {},
    })
    closing.push(async () => end.stop())
    await end.start()
    await until(() => network.signIns().length > 0, 'the machine in the sign-ins')

    expect(network.signIns()).toEqual([{
      machine: joined.machine,
      name: 'Example laptop',
      online: true,
      accounts: [
        { key: 'john.doe@example.com', agent: 'claude', email: 'john.doe@example.com', signedIn: false },
        { key: 'codex', agent: 'codex', email: 'jane.doe@example.com', signedIn: true },
        { key: 'token', agent: 'claude', email: 'jane.roe@example.com', signedIn: true, longToken: true },
      ],
      login,
      missing: ['opencode'],
    }])
    expect(republished).toBeGreaterThan(0)

    const sent = (type: string) => ran.filter((command) => command.type === type).map((command) => command.payload)
    await network.login(joined.machine, 'claude', 'john.doe@example.com')
    await network.login(joined.machine, 'claude', 'someone.else@example.com')
    await network.login(joined.machine, 'codex', undefined, 'device')
    await network.code(joined.machine, 'one-time-code')
    await network.cancel(joined.machine)
    expect(sent('account.renew')).toEqual([{ args: ['john.doe@example.com'] }])
    expect(sent('account.add')).toEqual([{ args: ['claude'] }, { args: ['codex', 'device'] }])
    expect(sent('account.code')).toEqual([{ args: ['one-time-code'] }])
    expect(sent('account.cancel')).toEqual([{ args: [] }])
    await network.token(joined.machine, 'hub-folder', 'sk-ant-oat01-fake-fake-fake-fake-fake', 'Laptop')
    expect(sent('account.addLongToken')).toEqual([{ args: ['Laptop', 'sk-ant-oat01-fake-fake-fake-fake-fake', null, { account: 'uuid-1', email: 'john.doe@example.com' }] }])
    await expect(network.token(joined.machine, 'nowhere', 'sk-ant-oat01-fake-fake-fake-fake-fake')).rejects.toThrow(/nowhere/)
    expect(lines.join(' ')).not.toContain('sk-ant-oat01')
    await expect(network.login(OWN, 'claude')).rejects.toThrow(/no such machine/)
  })
})
