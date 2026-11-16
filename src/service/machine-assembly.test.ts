import { expect, it, vi } from 'vitest'
import { emptyBrief, BriefCopy } from '../machine/brief.js'
import { laterTell, machineContext, type MachineHost } from './machine-context.js'
import { wireAccount, wireMonitor } from './accounts.js'

vi.mock('../account/watcher.js', () => ({ AccountWatcher: class { constructor(readonly options: unknown) {} } }))
vi.mock('../sessions/monitor.js', () => ({ SessionMonitor: class { constructor(readonly options: unknown) {} } }))

it('builds account and monitor reads from changing briefs and writes only to the machine', async () => {
  const read = emptyBrief()
  read.config.projects = { p: '/machine/repo' }
  read.config.keys = { p: 'ABC' }
  const brief = new BriefCopy()
  brief.take(read)
  const query = vi.fn(async () => ({ rows: [] }))
  const host = new Proxy({ machineDb: { query }, homes: { global: { dir: '/machine/global' }, find: () => ({ agent: 'claude' }) }, keyOrganizations: new Map(), managementKeys: new Map(), agents: [], sessions: [], journal: [] }, {
    get(target, name: string) {
      if (['db', 'configStore', 'dispatcher', 'hub', 'profiles'].includes(name)) throw new Error(`hub read: ${name}`)
      return Reflect.get(target, name)
    },
  }) as unknown as MachineHost
  const emit = vi.fn(async () => {})
  const tell = laterTell()
  tell.connect({ record: emit, changed: vi.fn(), leftover: vi.fn(), transcript: vi.fn() })
  const ctx = machineContext(host, brief, tell)
  const account = (wireAccount(ctx) as unknown as { options: { loginBlock(): unknown; activate(key: string): void; organizations: { note(key: string, organization: string): void } } }).options
  const monitor = (wireMonitor(ctx) as unknown as { options: { projectKeys(): string[]; onSessionWindows(windows: [string, number][]): void } }).options
  expect(account.loginBlock()).toBeNull()
  brief.take({ ...read, active: [{ project: 'p', paused: false }] })
  expect(account.loginBlock()).toMatchObject({ chains: ['p'] })
  account.activate('example')
  account.organizations.note('example', 'example-org')
  monitor.onSessionWindows([['session', 123]])
  await ctx.writes.settled()
  expect(query).toHaveBeenCalledWith(expect.stringContaining('insert into key_organizations'), expect.arrayContaining(['example', 'example-org']))
  expect(emit).toHaveBeenCalledWith('machine.selection', { kind: 'active', provider: 'claude', value: 'example' })
  expect(emit).toHaveBeenCalledWith('session.windows', expect.objectContaining({ windows: [['session', 123]] }))
  ctx.sessions = []
  expect(ctx.sessions).toBe(host.sessions)
})
