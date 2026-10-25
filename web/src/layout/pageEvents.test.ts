import { describe, expect, it } from 'vitest'
import { notice } from '../../../src/notice/notice.js'
import type { CiView } from '../../../src/ci/model.js'
import { freshEvents, pageEvents, type EventsInput } from './pageEvents.js'

const none: EventsInput = { config: { shared: { ci: { guard: true, kinds: ['forgejo', 'github'] } }, projects: {} }, chain: { active: [], projects: {}, leftovers: {}, skipped: {} }, ci: {}, fixes: {}, sessions: [], tasks: [], forwards: {}, works: {} }
const chain = (fields: object) => ({ project: 'p1', current: null, paused: false, error: null, ...fields })
const view = (status: 'failure' | 'success'): CiView =>
  ({
    kind: 'forgejo',
    remote: 'origin',
    current: { run: { id: 7, commit: 'abc1234', status }, tasks: [], jobs: [] },
  }) as unknown as CiView

describe('pageEvents', () => {
  it('reports an uncounted red CI without promising that the next task waits', () => {
    const config = { ...none.config, projects: { p1: { ci: { guard: true, kinds: ['forgejo'] as const } } } }
    const github = { ...view('failure'), kind: 'github' as const, remote: 'github' }
    expect(pageEvents({ ...none, config, ci: { p1: [view('success'), github] } })).toEqual([
      { key: 'ciRed|p1|github|github|abc1234', kind: 'ciRed', project: 'p1', ci: 'github', commit: 'abc1234' },
    ])
    expect(pageEvents({ ...none, config, ci: { p1: [view('failure'), github] } }).map((event) => event.kind)).toEqual(['red', 'ciRed'])
  })

  it('uses shared CI settings and treats every CI as uncounted with the guard off', () => {
    for (const ci of [{ guard: false, kinds: ['forgejo'] as const }, { guard: true, kinds: [] }]) {
      const config = { ...none.config, shared: { ci } }
      expect(pageEvents({ ...none, config, ci: { p1: [view('failure')] } }).map((event) => event.kind)).toEqual(['ciRed'])
    }
  })

  it('sees nothing in a quiet state', () => {
    expect(pageEvents(none)).toEqual([])
  })

  it('sees a chain that waits for the limit or paused on it', () => {
    const waits = pageEvents({ ...none, chain: { ...none.chain, active: [chain({ limitUntil: '2026-10-22T20:00:00Z' })] } })
    expect(waits).toEqual([{ key: 'limit|p1|2026-10-22T20:00:00Z', kind: 'limit', project: 'p1', until: '2026-10-22T20:00:00Z' }])
    const paused = pageEvents({ ...none, chain: { ...none.chain, active: [chain({ paused: true, error: notice('chain.limitSpent', { until: '20:00' }) })] } })
    expect(paused.map((each) => each.kind)).toEqual(['limit'])
  })

  it('sees a red main once, by its run, its fix or a failed check of it', () => {
    const red = { key: 'red|p1|abc1234', kind: 'red', project: 'p1', commit: 'abc1234' }
    expect(pageEvents({ ...none, ci: { p1: [view('failure')] } })).toEqual([red])
    expect(pageEvents({ ...none, ci: { p1: [view('success')] } })).toEqual([])
    const check = notice('check.fixNotStarted', { commit: 'abc1234' })
    expect(pageEvents({ ...none, chain: { ...none.chain, active: [chain({ paused: true, error: check })] } })).toEqual([red])
    const fix = { id: 'ABC-FIX.1', red: 'abc1234def', at: '2026-10-22T19:00:00Z', end: null }
    expect(pageEvents({ ...none, ci: { p1: [view('failure')] }, fixes: { p1: [fix] } })).toEqual([red])
    expect(pageEvents({ ...none, fixes: { p1: [{ ...fix, end: { at: '2026-10-22T19:30:00Z', how: 'landed', commit: null } }] } })).toEqual([])
  })

  it('takes an open carry of a release for no red main, and still sees a fix open before it', () => {
    const carry = { id: 'EKR-CARRY.1', red: 'fed4321abc', at: '2026-10-24T14:46:00Z', end: null }
    expect(pageEvents({ ...none, fixes: { p1: [carry] } })).toEqual([])
    const fix = { id: 'ABC-FIX.1', red: 'abc1234def', at: '2026-10-24T14:40:00Z', end: null }
    expect(pageEvents({ ...none, fixes: { p1: [fix, carry] } })).toEqual([{ key: 'red|p1|abc1234', kind: 'red', project: 'p1', commit: 'abc1234' }])
  })

  it('sees a session that asks, under the project of its task', () => {
    const input = { ...none, sessions: [{ task: 'ABC-1', sessionId: 's1', asking: true }], tasks: [{ id: 'ABC-1', project: 'p1', title: 'Fix it' }] } as unknown as EventsInput
    expect(pageEvents(input)).toEqual([{ key: 'ask|s1', kind: 'ask', project: 'p1', task: 'ABC-1' }])
  })

  it('sees a carry held by a conflict', () => {
    const hold = notice('forward.conflict', { from: 'p1', into: 'p2', files: ['a.ts'] })
    const input = { ...none, forwards: { p1: { into: 'p2', behind: 2, hold, held: true } } }
    expect(pageEvents(input)).toEqual([{ key: 'conflict|p1|p2', kind: 'conflict', project: 'p1', into: 'p2' }])
  })

  it('hides a conflict assigned to the agent and sees it again when the agent is skipped', () => {
    const hold = notice('forward.conflict', { from: 'p1', into: 'p2', files: ['a.ts'] })
    const forward = { into: 'p2', behind: 2, hold, held: true }
    const conflict = pageEvents({ ...none, forwards: { p1: forward } })
    const assigned = pageEvents({ ...none, forwards: { p1: { ...forward, agent: 'ABC-CARRY' } } })
    expect(assigned).toEqual([])
    expect(freshEvents(new Set(conflict.map((each) => each.key)), assigned)).toEqual([])
    expect(freshEvents(new Set(assigned.map((each) => each.key)), conflict)).toEqual(conflict)
  })

  it('shows no conflict toast when the agent takes it automatically', () => {
    const hold = notice('forward.conflict', { from: 'p1', into: 'p2', files: ['a.ts'] })
    const input = { ...none, forwards: { p1: { into: 'p2', behind: 2, hold, held: true, agent: 'ABC-CARRY' } } }
    expect(freshEvents(new Set(), pageEvents(input))).toEqual([])
  })

  it('sees work left in the folder of a task out of the chain, but not of one in it or with a pull request', () => {
    const work = (files: number, ahead: number) => ({ path: 'D:/work/abc/.claude/worktrees/abc-1', branch: 'abc-1/task', files, ahead })
    const order = { order: ['ABC-2'], waiting: ['ABC-3'], backlog: ['ABC-1'], error: null }
    const input = (works: EventsInput['works'], extra: object = {}) =>
      ({ ...none, chain: { ...none.chain, projects: { p1: { ...order, ...extra } } }, works }) as EventsInput
    expect(pageEvents(input({ p1: { 'ABC-1': work(49, 0) } }))).toEqual([
      { key: 'work|p1|ABC-1', kind: 'work', project: 'p1', task: 'ABC-1', path: work(0, 0).path, files: 49, ahead: 0, backlog: true },
    ])
    expect(pageEvents(input({ p1: { 'ABC-9': work(0, 2) } }))).toEqual([
      { key: 'work|p1|ABC-9', kind: 'work', project: 'p1', task: 'ABC-9', path: work(0, 0).path, files: 0, ahead: 2, backlog: false },
    ])
    expect(pageEvents(input({ p1: { 'ABC-2': work(1, 0), 'ABC-3': work(1, 0) } }))).toEqual([])
    const reviews = [{ task: 'ABC-9', number: 7, url: 'https://example.com/pull/7', feedback: false }]
    expect(pageEvents(input({ p1: { 'ABC-9': work(0, 2) } }, { reviews }))).toEqual([])
    expect(pageEvents(input({ p1: { 'ABC-1': work(1, 0) } }, { error: notice('chain.unknownProject', { project: 'p1' }) }))).toEqual([])
  })

  it('sees the work of a closed task only once its cleanup left it, and none while a session works in the folder', () => {
    const work = { path: 'D:/work/abc/.claude/worktrees/abc-9', branch: 'abc-9/task', files: 3, ahead: 1 }
    const done = { id: 'ABC-9', project: 'p1', title: 'Done', status: { name: 'Done', category: 'Won' } }
    const leftover = { task: 'ABC-9', at: '2026-10-23T18:00:00Z', notice: notice('cleanup.worktreeKept', { path: work.path }) }
    const projects = { p1: { order: [], waiting: [], backlog: [], error: null } }
    const input = (extra: object, leftovers: object = {}) =>
      ({ ...none, chain: { active: [], projects, leftovers, skipped: {} }, works: { p1: { 'ABC-9': work } }, ...extra }) as unknown as EventsInput
    expect(pageEvents(input({ tasks: [done] }))).toEqual([])
    expect(pageEvents(input({ tasks: [done] }, { p1: [leftover] })).map((each) => each.key)).toEqual(['work|p1|ABC-9'])
    expect(pageEvents(input({ sessions: [{ task: 'ABC-9', sessionId: 's1', asking: false, lamp: 'working' }] }))).toEqual([])
  })
})

describe('freshEvents', () => {
  const ask = { key: 'ask|s1', kind: 'ask', project: 'p1', task: 'ABC-1' } as const
  it('shows nothing that was there when the page opened', () => {
    expect(freshEvents(null, [ask])).toEqual([])
  })

  it('shows what came since the last state', () => {
    expect(freshEvents(new Set(), [ask])).toEqual([ask])
    expect(freshEvents(new Set(['ask|s1']), [ask])).toEqual([])
  })
})
