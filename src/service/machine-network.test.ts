import { PGlite } from '@electric-sql/pglite'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseHubStore } from '../link/hub-store.js'
import { hubIdentity } from '../link/identity.js'
import { joinHub } from '../link/machine-transport.js'
import { ASSIGN_COMMAND, isRefusal, parseToken, type MachineAbout } from '../link/protocol.js'
import { ABC, fixture } from '../storage/database.fixture.js'
import { folderUnder, MachineNetwork } from './machine-network.js'

const OWN = '88888888-8888-4888-8888-888888888888'
const ABOUT: MachineAbout = { host: 'example-laptop', os: 'linux 6.8.0', evenKeel: '0.4.0', node: '24.11.0', git: '2.47.0', agents: {}, gitUser: true, root: '/home/example/projects' }

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

  const started = async () => {
    const db = await PGlite.create()
    await db.exec(fixture(55))
    const settings = { address: null as string | null }
    const changes: number[] = []
    const network = new MachineNetwork({
      db,
      store: new DatabaseHubStore(db),
      certificate: () => hubIdentity(db),
      own: () => OWN,
      address: () => settings.address,
      port: await freePort(),
      repoOf: (project) => (project === ABC ? 'D:\\repos\\example' : undefined),
      allowedHosts: () => ['box.example.com'],
      serviceHost: '0.0.0.0',
      changed: () => void changes.push(1),
      log: () => {},
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
})
