import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { encodeToken, type ConnectionToken, type MachineAbout } from '../link/protocol.js'
import { joinAsMachine, joinedWith, readLinkFile, statusLines, TEST_INSTANCE_VAR, type JoinDeps } from './join.js'

const STRING: ConnectionToken = { hub: 'https://hub.example.com:4749', fingerprint: 'ab'.repeat(32), machine: 'machine-1', secret: 'string-secret' }
const ABOUT: MachineAbout = { host: 'example-laptop', os: 'linux 6.8.0', evenKeel: '0.4.0', node: '24.11.0', git: null, agents: {}, gitUser: false, root: null }

describe('even-keel join', () => {
  const folders: string[] = []
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  })

  const setup = (over: Partial<JoinDeps> = {}) => {
    const stateDir = mkdtempSync(join(tmpdir(), 'ek-join-'))
    folders.push(stateDir)
    const kept: Array<{ token: ConnectionToken; root: string }> = []
    const deps: JoinDeps = {
      stateDir,
      env: {},
      defaultRoot: join(stateDir, 'projects'),
      serviceRuns: async () => false,
      projects: async () => 0,
      about: async (root) => ({ ...ABOUT, root }),
      exchange: async (token) => ({ ...token, secret: 'own-secret' }),
      keep: async (token, root) => void kept.push({ token, root }),
      now: () => 1794650000000,
      ...over,
    }
    return { deps, kept, stateDir }
  }

  it('keeps the machine its own secret and the folder of projects, and status tells the hub', async () => {
    const { deps, kept, stateDir } = setup()
    const file = await joinAsMachine(` ${encodeToken(STRING)}\n`, undefined, deps)
    expect(kept).toEqual([{ token: { ...STRING, secret: 'own-secret' }, root: join(stateDir, 'projects') }])
    expect(readLinkFile(stateDir)).toEqual(file)
    expect(statusLines(file, 1794650000000)).toContain('  last contact with the hub: none since the join')
    expect(statusLines(readLinkFile(join(stateDir, 'none')), 0)[0]).toMatch(/^not a machine/)
    expect(statusLines({ ...file, contactAt: 1794649940000 }, 1794650000000).at(-1)).toMatch(/\(1 min ago\)$/)
  })

  it('refuses a test installation, a running service, an installation with projects and a broken line, keeping nothing', async () => {
    const line = encodeToken(STRING)
    const cases: Array<[Partial<JoinDeps>, string, RegExp]> = [
      [{ env: { [TEST_INSTANCE_VAR]: '1' } }, line, /test installation/],
      [{}, 'ekm1.broken', /not a connection string/],
      [{ serviceRuns: async () => true }, line, /stop it first/],
      [{ projects: async () => 2 }, line, /2 project\(s\) of its own/],
      [{ exchange: async () => ({ refused: 'expired' }) }, line, /expired/],
      [{ exchange: async () => ({ refused: 'used' }) }, line, /has joined with this connection string/],
      [{ exchange: async () => { throw new Error('connect ECONNREFUSED') } }, line, /was not reached: connect ECONNREFUSED/],
    ]
    for (const [over, given, message] of cases) {
      const { deps, kept, stateDir } = setup(over)
      await expect(joinAsMachine(given, undefined, deps)).rejects.toThrow(message)
      expect(kept).toEqual([])
      expect(readLinkFile(stateDir)).toBeUndefined()
    }
  })

  it('knows a string this installation has joined with already, so an installer run again does not join twice', async () => {
    const { deps, stateDir } = setup()
    expect(joinedWith(stateDir, encodeToken(STRING))).toBeUndefined()
    const file = await joinAsMachine(encodeToken(STRING), undefined, deps)
    expect(joinedWith(stateDir, ` ${encodeToken(STRING)}\n`)).toEqual(file)
    expect(joinedWith(stateDir, encodeToken({ ...STRING, machine: 'machine-2' }))).toBeUndefined()
    expect(joinedWith(stateDir, encodeToken({ ...STRING, hub: 'https://other.example.com:4749' }))).toBeUndefined()
    expect(joinedWith(stateDir, 'ekm1.broken')).toBeUndefined()
  })

  it('takes the folder of projects given with --root', async () => {
    const { deps, kept, stateDir } = setup()
    await joinAsMachine(encodeToken(STRING), join(stateDir, 'elsewhere'), deps)
    expect(kept[0]?.root).toBe(join(stateDir, 'elsewhere'))
  })
})
