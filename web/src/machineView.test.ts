import { describe, expect, it } from 'vitest'
import { fakeTask } from '../../src/tracker/fixture.js'
import type { EvenKeelState, MachineCard } from '../../src/state.js'
import { machineBacklog, machineChain, machineState, poolOf } from './machineView.js'
import type { ChainBlock } from './state.js'

const card = (id: string, patch: Partial<MachineCard> = {}): MachineCard => ({
  id, name: id, color: '#7a8fa6', own: id === 'pc', online: true, offlineSince: null, gitUser: true, agents: ['claude'], limitedUntil: {},
  projects: [{ project: 'ABC', enabled: true, packagesBlocked: false }], ...patch,
})

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
    expect(machineState(view, cards, card('srv', { gitUser: false }), 'ABC')).toEqual({ lamp: 'blocked', reason: 'git' })
    expect(machineState(view, cards, card('srv', { projects: [{ project: 'ABC', enabled: true, packagesBlocked: true }] }), 'ABC')).toEqual({ lamp: 'blocked', reason: 'packages' })
    expect(machineState(view, cards, card('srv', { limitedUntil: { claude: '2026-11-17T18:40:00Z' } }), 'ABC')).toEqual({ lamp: 'limit', until: '2026-11-17T18:40:00Z' })
    expect(machineState(view, cards, cards[1]!, 'ABC')).toEqual({ lamp: 'free', task: { id: 'ABC-2', title: 'Title ABC-2' } })
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
})

describe('machineBacklog', () => {
  it('leaves the tasks of a provider the machine may not run', () => {
    const cards = [card('pc'), card('srv', { agents: ['codex'] })]
    expect(machineBacklog([{ id: 'ABC-2' }, { id: 'ABC-3' }], state(), cards, 'ABC', 'srv')).toEqual([{ id: 'ABC-3' }])
  })
})
