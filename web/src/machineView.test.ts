import { describe, expect, it } from 'vitest'
import { fakeTask } from '../../src/tracker/fixture.js'
import type { EvenKeelState, MachineCard } from '../../src/state.js'
import { machineBacklog, machineChain, machineCount, machineHeader, machineProjects, machineState, mergeQueue, poolOf, severalMachines } from './machineView.js'
import type { ChainBlock } from './state.js'

const card = (id: string, patch: Partial<MachineCard> = {}): MachineCard => ({
  id, name: id, color: '#7a8fa6', own: id === 'pc', online: true, offlineSince: null, gitUser: true, agents: ['claude'], limitedUntil: {},
  projects: [projectRow('ABC')], accounts: [], active: null, ...patch,
})

function projectRow(project: string, enabled = true, packagesBlocked = false): MachineCard['projects'][number] {
  return { project, enabled, packagesBlocked, packagesUnready: [], trackerMissing: null }
}

const state = (patch: Partial<EvenKeelState['chain']> = {}) =>
  ({
    tasks: ['ABC-1', 'ABC-2', 'ABC-3'].map((id) => ({ ...fakeTask(id, { title: `Title ${id}` }), project: 'ABC' })),
    runs: { ABC: { 'ABC-3': { provider: 'codex', model: null, effort: null } } },
    config: { projects: { ABC: { provider: null } }, shared: { provider: 'claude' } },
    ownMachine: 'pc',
    taskSessions: {},
    chain: { active: [], queue: ['ABC'], parallel: 2, projects: { ABC: { order: ['ABC-1', 'ABC-2', 'ABC-3'], waiting: [], backlog: [], error: null } }, skipped: {}, leftovers: {}, ...patch },
  }) as unknown as EvenKeelState

const lane = (machine: string | undefined, task: string | null) => ({
  project: 'ABC', ...(machine !== undefined && { machine }), current: task === null ? null : { task, sessionId: null, since: '' }, paused: false, error: null,
})

describe('machineState', () => {
  it('judges a card offline, then working, then blocked, then at a limit, then free', () => {
    const view = state({ active: [lane(undefined, 'ABC-1')] as never })
    const cards = [card('pc'), card('srv')]
    expect(machineState(view, cards, card('srv', { online: false, offlineSince: 5 }), 'ABC')).toEqual({ lamp: 'offline', since: 5 })
    expect(machineState(view, cards, cards[0]!, 'ABC')).toEqual({ lamp: 'working', task: { id: 'ABC-1', title: 'Title ABC-1' } })
    expect(machineState(view, cards, card('srv', { otherBuild: '0.3.9', gitUser: false }), 'ABC')).toEqual({ lamp: 'blocked', reason: 'version', version: '0.3.9' })
    expect(machineState(view, cards, card('srv', { gitUser: false }), 'ABC')).toEqual({ lamp: 'blocked', reason: 'git' })
    expect(machineState(view, cards, card('srv', { projects: [projectRow('ABC', true, true)] }), 'ABC')).toEqual({ lamp: 'blocked', reason: 'packages' })
    expect(machineState(view, cards, card('srv', { limitedUntil: { claude: '2026-11-17T18:40:00Z' } }), 'ABC')).toEqual({ lamp: 'limit', until: '2026-11-17T18:40:00Z' })
    expect(machineState(view, cards, cards[1]!, 'ABC')).toEqual({ lamp: 'free', task: { id: 'ABC-2', title: 'Title ABC-2' } })
    // The hub refuses a machine of another protocol at the handshake: off the link, its card names the other build (BTN-1609).
    expect(machineState(view, cards, card('srv', { online: false, offlineSince: 5, otherBuild: '0.3.9' }), 'ABC')).toEqual({ lamp: 'blocked', reason: 'version', version: '0.3.9' })
  })

  it('guesses the next task past the ones held, skipped and of a provider the machine has no account of', () => {
    const cards = [card('pc'), card('srv', { agents: ['claude', 'codex'] })]
    const view = state({ active: [lane('srv', 'ABC-1')] as never, skipped: { ABC: ['ABC-2'] } })
    expect(machineState(view, cards, cards[0]!, 'ABC')).toEqual({ lamp: 'free' })
    expect(machineState(state(), cards, cards[0]!)).toMatchObject({ task: { id: 'ABC-1' } })
  })

  it('guesses past a task begun on another machine, a session without one being the own machine’s', () => {
    const cards = [card('pc'), card('srv')]
    const view = { ...state(), taskSessions: { 'ABC-1': [{}], 'ABC-2': [{ machine: 'srv' }] } } as unknown as EvenKeelState
    expect(machineState(view, cards, cards[1]!, 'ABC')).toMatchObject({ task: { id: 'ABC-2' } })
    expect(machineState(view, cards, cards[0]!, 'ABC')).toMatchObject({ task: { id: 'ABC-1' } })
  })

  it('judges a card off any project page by the projects of its pool', () => {
    const cards = [card('pc'), card('srv', { projects: [] })]
    expect(machineState(state(), cards, cards[1]!)).toEqual({ lamp: 'free' })
  })
})

describe('poolOf', () => {
  it('falls back to the own machine where no row is on', () => {
    expect(poolOf([card('pc', { projects: [] }), card('srv', { projects: [] })], 'ABC').map((each) => each.id)).toEqual(['pc'])
  })
})

const block = (id: string, patch: Partial<ChainBlock> = {}) => ({ id, open: true, locked: false, current: false, sessions: [], run: null, ...patch }) as ChainBlock

describe('machineChain', () => {
  const cards = [card('pc'), card('srv')]
  const tag = (id: string) => [{ id, name: id }]

  it('keeps a machine its own tasks and those it may take, without the tags', () => {
    const blocks = [
      block('ABC-1', { open: false, machines: tag('pc') }),
      block('ABC-2', { machines: [...tag('pc'), ...tag('srv')] }),
      block('ABC-3', { run: { provider: 'codex', model: null, effort: null } }),
      block('ABC-4'),
      block('ABC-FIX.1', { open: false }),
    ]
    const view = state()
    expect(machineChain(blocks, view, cards, 'ABC', 'srv').map((each) => [each.id, each.machines])).toEqual([['ABC-2', undefined], ['ABC-3', undefined], ['ABC-4', undefined]])
    expect(machineChain(blocks, view, [card('pc'), card('srv', { agents: ['codex'] })], 'ABC', 'pc').map((each) => each.id)).toEqual(['ABC-1', 'ABC-4', 'ABC-FIX.1'])
  })

  it('counts a task run or running without a machine tag as the own machine’s', () => {
    const blocks = [block('ABC-1', { current: true }), block('ABC-2', { open: false, sessions: [{} as ChainBlock['sessions'][number]] }), block('ABC-3', { open: false })]
    expect(machineChain(blocks, state(), cards, 'ABC', 'srv').map((each) => each.id)).toEqual(['ABC-3'])
    expect(machineChain(blocks, state(), cards, 'ABC', 'pc').map((each) => each.id)).toEqual(['ABC-1', 'ABC-2', 'ABC-3'])
  })

  it('shows a machine out of the pool none of the open tasks', () => {
    const blocks = [block('ABC-1')]
    expect(machineChain(blocks, state(), [card('pc'), card('srv', { projects: [] })], 'ABC', 'srv')).toEqual([])
  })

  it('gives an open task pinned to machines only to those, its pin tag not read as where it ran (BTN-1623)', () => {
    const view = { ...state(), runs: { ABC: { 'ABC-2': { provider: null, model: null, effort: null, machines: ['srv'] } } } } as EvenKeelState
    const blocks = [block('ABC-1'), block('ABC-2', { machines: tag('srv'), pinned: true })]
    expect(machineChain(blocks, view, cards, 'ABC', 'pc').map((each) => each.id)).toEqual(['ABC-1'])
    expect(machineChain(blocks, view, cards, 'ABC', 'srv').map((each) => each.id)).toEqual(['ABC-1', 'ABC-2'])
  })
})

describe('machineBacklog', () => {
  it('leaves the tasks of a provider the machine may not run', () => {
    const cards = [card('pc'), card('srv', { agents: ['codex'] })]
    expect(machineBacklog([{ id: 'ABC-2' }, { id: 'ABC-3' }], state(), cards, 'ABC', 'srv')).toEqual([{ id: 'ABC-3' }])
  })

  it('leaves the tasks pinned to other machines (BTN-1623)', () => {
    const view = { ...state(), runs: { ABC: { 'ABC-2': { provider: null, model: null, effort: null, machines: ['srv'] } } } } as EvenKeelState
    expect(machineBacklog([{ id: 'ABC-1' }, { id: 'ABC-2' }], view, [card('pc'), card('srv')], 'ABC', 'pc')).toEqual([{ id: 'ABC-1' }])
  })
})

describe('machineProjects', () => {
  const row = (project: string, enabled = true) => projectRow(project, enabled)

  it('keeps the projects whose pool has the machine, turned off too, in their order', () => {
    const cards = [card('pc', { projects: [row('ABC'), row('DEF')] }), card('srv', { projects: [row('DEF', false), row('ABC')] })]
    expect(machineProjects(cards, ['ABC', 'DEF', 'GHI'], 'srv')).toEqual(['ABC', 'DEF'])
  })

  it('gives the own machine every project without a pool', () => {
    const cards = [card('pc', { projects: [] }), card('srv', { projects: [row('DEF')] })]
    expect(machineProjects(cards, ['ABC', 'DEF'], 'pc')).toEqual(['ABC'])
  })
})

describe('mergeQueue', () => {
  it('puts a machine’s reordered projects back into the places they held in the whole queue', () => {
    expect(mergeQueue(['A', 'X', 'B', 'Y', 'C'], ['C', 'A', 'B'])).toEqual(['C', 'X', 'A', 'Y', 'B'])
  })

  it('changes nothing for the whole queue reordered', () => {
    expect(mergeQueue(['A', 'B'], ['B', 'A'])).toEqual(['B', 'A'])
  })
})

describe('machineHeader', () => {
  const row = (project: string) => projectRow(project)
  const cards = [card('pc', { projects: [row('ABC'), row('DEF')] }), card('srv', { projects: [row('ABC')] })]
  const session = (task: string) => ({ task, sessionId: `s-${task}`, lamp: 'question' })
  const full = {
    ...state({ active: [lane('srv', 'ABC-1'), lane(undefined, 'ABC-2'), { ...lane(undefined, 'DEF-1'), project: 'DEF' }] as never, queue: ['DEF', 'ABC'] }),
    sessions: [session('ABC-1'), session('ABC-2'), session('ABC-3'), session('DEF-1')],
    taskSessions: { 'ABC-3': [{ machine: 'pc' }, { machine: 'srv' }] },
  } as unknown as EvenKeelState

  it('keeps a machine its lanes, the queue of its projects and the sessions of the tasks it runs or ran last', () => {
    const view = machineHeader(full, cards, 'srv')
    expect(view.chain.active.map((each) => each.current?.task)).toEqual(['ABC-1'])
    expect(view.chain.queue).toEqual(['ABC'])
    expect(view.sessions.map((each) => each.task)).toEqual(['ABC-1', 'ABC-3'])
  })

  it('gives the own machine the lanes and sessions without a machine', () => {
    const view = machineHeader(full, cards, 'pc')
    expect(view.chain.active.map((each) => each.current?.task)).toEqual(['ABC-2', 'DEF-1'])
    expect(view.chain.queue).toEqual(['DEF', 'ABC'])
    expect(view.sessions.map((each) => each.task)).toEqual(['ABC-2', 'DEF-1'])
  })
})

describe('machineCount', () => {
  it('gives the bare count while every machine is on the link', () => {
    expect(machineCount([card('pc'), card('srv')])).toEqual({ text: '2', away: [] })
  })

  it('gives online/all and the names of the machines off the link', () => {
    const cards = [card('pc'), card('srv', { name: 'Server', online: false }), card('box', { name: 'Box', online: false })]
    expect(machineCount(cards)).toEqual({ text: '1/3', away: ['Server', 'Box'] })
  })
})

describe('whether the hub has several machines (BTN-1552)', () => {
  const names = { pc: 'Workstation', old: 'Old workstation', srv: 'Home server' }

  it('counts the live ones, not every machine the hub ever had', () => {
    expect(severalMachines({ machineNames: { pc: names.pc, old: names.old }, liveMachines: ['pc'] })).toBe(false)
    expect(severalMachines({ machineNames: names, liveMachines: ['pc', 'srv'] })).toBe(true)
  })

  it('falls back to the names of an older service that tells no live ones', () => {
    expect(severalMachines({ machineNames: { pc: names.pc } })).toBe(false)
    expect(severalMachines({ machineNames: names })).toBe(true)
    expect(severalMachines(null)).toBe(false)
  })
})
