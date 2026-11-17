import { describe, expect, it } from 'vitest'
import type { AccountEntry, AccountView } from '../account/model.js'
import type { MachineRecord } from '../link/hub-store.js'
import type { MachineAbout } from '../link/view.js'
import type { MachineFacts } from '../machine/facts.js'
import { pageReads } from '../machine/page.js'
import type { RateLimits } from '../limits/model.js'
import { machineCards, type MachineCardsDeps } from './machine-cards.js'

const NOW = Date.parse('2026-11-17T16:00:00.000Z')
const ABOUT: MachineAbout = { host: 'example-host', os: 'linux 6.8.0', evenKeel: '0.4.0', node: '24.11.0', git: '2.47.0', agents: { claude: '2.1.0' }, gitUser: true, root: '/home/example/projects' }

const record = (id: string, patch: Partial<MachineRecord> = {}): MachineRecord => ({
  id, name: id, secretHash: '', createdAt: 0, revokedAt: null, host: null, lastEvent: 0, inviteExpires: null, joinedAt: 1, about: ABOUT, capacity: 1, color: null, ...patch,
})

const spent = (resetsAt: string): RateLimits => ({ fiveHour: { usedPercentage: 100, resetsAt }, sevenDay: null, updatedAt: '2026-11-17T15:00:00.000Z', source: 'usage' }) as RateLimits
const half: RateLimits = { fiveHour: { usedPercentage: 50, resetsAt: '2026-11-17T18:00:00.000Z' }, sevenDay: null, updatedAt: '2026-11-17T15:00:00.000Z', source: 'usage' } as RateLimits

const entry = (key: string, agent: string, limits: RateLimits | null, loggedIn = true) =>
  ({ key, agent, status: { loggedIn, email: `${key}@example.com` }, needsLogin: false, limits }) as unknown as AccountEntry

function mirror(accounts: AccountEntry[], projects: Record<string, boolean> = {}) {
  const facts = {
    sessions: {},
    panel: { accounts: accounts.map((each) => ({ ...each, limits: null })), missing: [] } as unknown as AccountView,
    limits: Object.fromEntries(accounts.map((each) => [each.key, each.limits])),
    projects: Object.fromEntries(Object.entries(projects).map(([project, blocked]) => [project, { packagesBlocked: blocked, run: {}, tasks: {}, reported: {} }])),
  } as unknown as MachineFacts
  return { facts: () => facts, page: pageReads(() => facts) }
}

function deps(patch: Partial<MachineCardsDeps> = {}): MachineCardsDeps {
  return {
    own: () => 'pc',
    records: async () => [record('pc', { joinedAt: null }), record('laptop'), record('gone', { revokedAt: 5 }), record('invited', { joinedAt: null, inviteExpires: NOW + 1 })],
    online: (machine) => machine === 'laptop',
    offlineSince: () => undefined,
    colors: () => ({ pc: '#111111', laptop: '#222222' }),
    folders: async (machine) => (machine === 'laptop' ? [{ project: 'p1', folder: '/x', enabled: true }] : [{ project: 'p1', folder: '/y', enabled: false }]),
    mirror: () => undefined,
    ownAccounts: () => [],
    ownGitUser: () => true,
    now: () => NOW,
    ...patch,
  }
}

describe('machineCards', () => {
  it('lists the own machine and the joined ones not revoked, the own one first', async () => {
    const cards = await machineCards(deps())
    expect(cards.map((card) => card.id)).toEqual(['pc', 'laptop'])
    expect(cards[0]).toMatchObject({ own: true, online: true, color: '#111111', gitUser: true, offlineSince: null, projects: [{ project: 'p1', enabled: false, packagesBlocked: false }] })
    expect(cards[1]).toMatchObject({ own: false, online: true, color: '#222222', gitUser: true })
  })

  it('says since when a machine is off the link', async () => {
    const cards = await machineCards(deps({ online: () => false, offlineSince: (machine) => (machine === 'laptop' ? NOW - 7_200_000 : undefined) }))
    expect(cards[1]).toMatchObject({ online: false, offlineSince: NOW - 7_200_000 })
  })

  it('takes git without a user from the report, and nothing before the first one', async () => {
    const records = async () => [record('pc'), record('laptop', { about: { ...ABOUT, gitUser: false } }), record('desk', { about: null })]
    const cards = await machineCards(deps({ records }))
    expect(cards.map((card) => card.gitUser)).toEqual([true, false, null])
  })

  it('marks an agent limited only when every signed-in account of it is spent, until the first frees', async () => {
    const accounts = [entry('a', 'claude', spent('2026-11-17T18:40:00.000Z')), entry('b', 'claude', spent('2026-11-17T17:10:00.000Z')), entry('c', 'codex', half), entry('d', 'codex', spent('2026-11-17T19:00:00.000Z')), entry('e', 'codex', null, false)]
    const cards = await machineCards(deps({ mirror: (machine) => (machine === 'laptop' ? mirror(accounts, { p1: true }) : undefined) }))
    expect(cards[1]).toMatchObject({ agents: ['claude', 'codex'], limitedUntil: { claude: '2026-11-17T17:10:00.000Z' }, projects: [{ project: 'p1', enabled: true, packagesBlocked: true }] })
  })

  it('reads the own machine from its own accounts, a window gone by not counting', async () => {
    const ownAccounts = () => [entry('main', 'claude', spent('2026-11-17T15:30:00.000Z'))]
    const cards = await machineCards(deps({ ownAccounts }))
    expect(cards[0]).toMatchObject({ agents: ['claude'], limitedUntil: {} })
  })
})
