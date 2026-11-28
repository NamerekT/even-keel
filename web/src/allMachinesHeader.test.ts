import { describe, expect, it } from 'vitest'
import type { AccountLevel } from '../../src/account/header-levels.js'
import type { AccountEntry, AccountView } from '../../src/account/model.js'
import type { ActiveChainView, MachineCard, MachineSignIn, SessionView } from '../../src/state.js'
import { accountOutOn, allMachinesLevels, type AllMachinesView } from './allMachinesHeader.js'

const entry = (key: string, patch: Partial<AccountEntry> = {}): AccountEntry =>
  ({ key, agent: 'claude', status: { loggedIn: true, email: `${key}@example.com` }, ...patch }) as unknown as AccountEntry

const lane = (task: string, machine?: string, sessionId: string | null = `s-${task}`): ActiveChainView =>
  ({ project: 'ABC', ...(machine !== undefined && { machine }), current: { task, sessionId, since: '' }, paused: false, error: null }) as ActiveChainView

const session = (task: string, account: string | null, agent = 'claude'): SessionView =>
  ({ task, sessionId: `s-${task}`, agent, account }) as unknown as SessionView

/** The hub's levels of ABC: the project on jane, Even Keel on john, the first task on the project's account. */
const HUB: AccountLevel[] = [{ account: 'jane', source: 'project' }, { account: 'john', source: 'shared' }]

function view(active: ActiveChainView[], sessions: SessionView[], levels: AccountLevel[] = HUB): AllMachinesView {
  const account = { active: 'john', accounts: [entry('john'), entry('jane'), entry('sam')], pool: [], headerLevels: { ABC: levels } } as unknown as AccountView
  return { account, chain: { active } as AllMachinesView['chain'], sessions, ownMachine: 'pc' }
}

describe('allMachinesLevels', () => {
  it('keeps the hub\'s levels on one machine, though its lanes run on two accounts', () => {
    const state = view([lane('ABC-1'), lane('ABC-2', 'pc')], [session('ABC-1', 'jane@example.com'), session('ABC-2', 'sam@example.com')])
    expect(allMachinesLevels(state, 'ABC', 'ABC-2')).toEqual(HUB)
  })

  it('keeps the hub\'s levels on two machines of one account', () => {
    const state = view([lane('ABC-1'), lane('ABC-2', 'srv')], [session('ABC-1', 'jane@example.com'), session('ABC-2', 'Jane@Example.com')])
    expect(allMachinesLevels(state, 'ABC', 'ABC-2')).toEqual(HUB)
  })

  describe('two machines on two accounts', () => {
    const state = view([lane('ABC-1'), lane('ABC-2', 'srv'), lane('ABC-3', 'srv', null)], [session('ABC-1', 'jane@example.com'), session('ABC-2', 'sam@example.com')])

    it('shows the project and Even Keel without a focus', () => {
      expect(allMachinesLevels(state, 'ABC', '')).toEqual(HUB)
    })

    it('drops the hub\'s task level without a focus', () => {
      const hub: AccountLevel[] = [{ account: 'sam', source: 'task', task: 'ABC-1' }, ...HUB]
      expect(allMachinesLevels(view(state.chain.active, state.sessions, hub), 'ABC', '')).toEqual(HUB)
    })

    it('takes the inherited levels the hub\'s task level absorbed', () => {
      const absorbed = view(state.chain.active, state.sessions, [{ account: 'jane', source: 'task', task: 'ABC-1' }])
      absorbed.account.inheritedLevels = { ABC: [{ account: 'jane', source: 'shared' }] }
      expect(allMachinesLevels(absorbed, 'ABC', '')).toEqual([{ account: 'jane', source: 'shared' }])
      expect(allMachinesLevels(absorbed, 'ABC', 'ABC-2')).toEqual([{ account: 'sam', source: 'task', task: 'ABC-2' }, { account: 'jane', source: 'shared' }])
    })

    it('shows the focused second task\'s account as the task level', () => {
      expect(allMachinesLevels(state, 'ABC', 'ABC-2')).toEqual([{ account: 'sam', source: 'task', task: 'ABC-2' }, ...HUB])
    })

    it('shows the focused first task\'s account as the task level, over the project of the same account', () => {
      expect(allMachinesLevels(state, 'ABC', 'ABC-1')).toEqual([{ account: 'jane', source: 'task', task: 'ABC-1' }, { account: 'john', source: 'shared' }])
    })

    it('shows the project level for a focused task without a live session', () => {
      expect(allMachinesLevels(state, 'ABC', 'ABC-3')).toEqual(HUB)
      expect(allMachinesLevels(state, 'ABC', 'ABC-9')).toEqual(HUB)
    })

    it('is the second level where the project is Even Keel\'s account', () => {
      const shared: AccountLevel[] = [{ account: 'john', source: 'shared' }]
      expect(allMachinesLevels(view(state.chain.active, state.sessions, shared), 'ABC', 'ABC-2')).toEqual([{ account: 'sam', source: 'task', task: 'ABC-2' }, ...shared])
    })

    it('finds the hub\'s folder of a session named by its folder', () => {
      const keyed = view(state.chain.active, [session('ABC-1', 'jane'), session('ABC-2', 'sam')])
      expect(allMachinesLevels(keyed, 'ABC', 'ABC-2')?.[0]).toEqual({ account: 'sam', source: 'task', task: 'ABC-2' })
    })

    it('shows the project level where the hub has no folder of the session\'s account', () => {
      const away = view(state.chain.active, [session('ABC-1', 'jane@example.com'), session('ABC-2', 'max@example.com')])
      expect(allMachinesLevels(away, 'ABC', 'ABC-2')).toEqual(HUB)
    })
  })

  it('counts the same e-mail on two agents as two accounts', () => {
    const state = view([lane('ABC-1'), lane('ABC-2', 'srv')], [session('ABC-1', 'jane@example.com'), session('ABC-2', 'jane@example.com', 'codex')])
    state.account.accounts.push(entry('jane-codex', { agent: 'codex', status: { loggedIn: true, email: 'jane@example.com' } as AccountEntry['status'] }))
    expect(allMachinesLevels(state, 'ABC', 'ABC-2')?.[0]).toEqual({ account: 'jane-codex', source: 'task', task: 'ABC-2' })
  })

  it('leaves the levels to the block outside a project', () => {
    expect(allMachinesLevels(view([], []), undefined, '')).toBeUndefined()
  })
})

const card = (id: string, projects: string[]): MachineCard => ({
  id, name: `Example ${id}`, color: '#7a8fa6', own: id === 'pc', online: true, offlineSince: null, gitUser: true, agents: ['claude'],
  limitedUntil: {}, accounts: [], active: null,
  projects: projects.map((project) => ({ project, enabled: true, packagesBlocked: false, packagesUnready: [], trackerMissing: null })),
})

const signIn = (machine: string, signedIn: boolean, email = 'jane@example.com'): MachineSignIn =>
  ({ machine, name: `Example ${machine}`, online: true, accounts: [{ key: 'folder', agent: 'claude', email, signedIn }], login: null, missing: [] }) as MachineSignIn

describe('accountOutOn', () => {
  const cards = [card('pc', ['ABC']), card('m1', ['ABC']), card('m2', ['XYZ']), card('m3', ['ABC'])]
  const account = { active: 'john', accounts: [entry('john'), entry('jane')], pool: [] } as unknown as AccountView

  it('names the project\'s machines where the account is signed out', () => {
    const machineSignIns = [signIn('m1', false), signIn('m2', false), signIn('m3', true)]
    expect(accountOutOn({ account, machineSignIns }, cards, 'ABC', 'jane')).toEqual(['Example m1'])
  })

  it('names every machine outside a project', () => {
    const machineSignIns = [signIn('m1', false), signIn('m2', false)]
    expect(accountOutOn({ account, machineSignIns }, cards, undefined, 'jane')).toEqual(['Example m1', 'Example m2'])
  })

  it('names none where the account never signed in there or is signed in', () => {
    const machineSignIns = [signIn('m1', false, 'max@example.com'), signIn('m3', true)]
    expect(accountOutOn({ account, machineSignIns }, cards, 'ABC', 'jane')).toEqual([])
    expect(accountOutOn({ account, machineSignIns }, cards, 'ABC', 'gone')).toEqual([])
  })
})
