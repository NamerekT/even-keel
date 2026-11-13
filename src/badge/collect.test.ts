import { describe, expect, it } from 'vitest'
import type { EvenKeelState, FeedLine } from '../state.js'
import { ALL_BADGE_FIELDS, badgeStateOf } from './collect.js'

const ABC = '11111111-1111-4111-8111-111111111111'
const now = new Date('2026-11-09T12:00:00Z')
const task = (id: string, category: string, milestone: string | null = 'v1') => ({
  id,
  project: ABC,
  title: `Secret title of ${id}`,
  status: { name: category, category },
  milestone: milestone === null ? null : { label: milestone },
})
const tool = (text: string, badge?: FeedLine['badge']): FeedLine => ({ kind: 'tool', at: now.toISOString(), text, ...(badge === undefined ? {} : { badge }) }) as FeedLine

interface Overrides {
  asking?: boolean
  paused?: boolean
  current?: boolean
  feed?: FeedLine[]
  lamp?: string
  /** The chain's hold of the current task on a limit. */
  limit?: Record<string, unknown>
}

function stateWith(overrides: Overrides = {}): EvenKeelState {
  const current = overrides.current ?? true
  const hold = overrides.limit === undefined ? {} : { limit: overrides.limit }
  return {
    projects: [ABC],
    projectKeys: { [ABC]: 'ABC' },
    config: { projects: { [ABC]: { name: 'Example' } } },
    context: { window: 200_000 },
    tasks: [
      task('ABC-1', 'Won'),
      task('ABC-2', 'Won'),
      task('ABC-3', 'Lost'),
      task('ABC-4', 'Started'),
      task('ABC-5', 'Unstarted'),
      task('ABC-6', 'Unstarted', 'v2'),
      ...Array.from({ length: 6 }, (_, index) => task(`ABC-${10 + index}`, 'Won', 'old')),
    ],
    chain: {
      active: [{ project: ABC, paused: overrides.paused ?? false, current: current ? { task: 'ABC-4', sessionId: 's-1', since: '2026-11-09T11:30:00Z', ...hold } : null }],
      projects: { [ABC]: { order: ['ABC-4', 'ABC-5', 'ABC-6'] } },
    },
    sessions: [
      {
        sessionId: 's-1',
        task: 'ABC-4',
        agent: 'claude',
        model: 'opus',
        lamp: overrides.lamp ?? 'working',
        asking: overrides.asking ?? false,
        contextTokens: 50_000,
        contextWindow: null,
        action: null,
        feed: overrides.feed ?? [tool('Edit C:/repo/src/a.ts', { tool: 'Edit', text: 'Edit src/a.ts' }), tool('mcp__x__y secret')],
      },
    ],
  } as unknown as EvenKeelState
}

describe('badgeStateOf', () => {
  it('publishes the working task, the chain chips and the milestone with every field on', () => {
    const state = badgeStateOf(stateWith(), ABC, { now, fields: ALL_BADGE_FIELDS, stats: { sessions: 3, medianCost: 1.5, medianMinutes: 12 }, titleEn: () => ' Draw the badge ' })
    expect(state).toEqual({
      v: 1,
      at: '2026-11-09T12:00:00.000Z',
      project: { key: 'ABC', name: 'Example' },
      active: [{ key: 'ABC-4', titleEn: 'Draw the badge', agent: 'claude', model: 'opus', startedAt: '2026-11-09T11:30:00Z', state: 'working', action: { tool: 'mcp__x__y', text: 'mcp__x__y' }, context: 25 }],
      chain: {
        state: 'running',
        next: 'ABC-5',
        tasks: [
          { key: 'ABC-11', state: 'done' },
          { key: 'ABC-12', state: 'done' },
          { key: 'ABC-13', state: 'done' },
          { key: 'ABC-14', state: 'done' },
          { key: 'ABC-15', state: 'done' },
          { key: 'ABC-4', state: 'working' },
          { key: 'ABC-5', state: 'queued' },
          { key: 'ABC-6', state: 'queued' },
        ],
      },
      milestone: { name: 'v1', done: 2, left: 2, queued: 2 },
      stats: { sessions: 3, medianCost: 1.5, medianMinutes: 12 },
    })
  })

  it('takes the latest tool line\'s own badge text', () => {
    const state = badgeStateOf(stateWith({ feed: [tool('Grep x'), tool('Edit C:/repo/src/a.ts', { tool: 'Edit', text: 'Edit src/a.ts' })] }), ABC, { now, fields: ['action'], stats: null })
    expect(state.active[0]?.action).toEqual({ tool: 'Edit', text: 'Edit src/a.ts' })
  })

  describe('a task handed over to a new session (BTN-1114)', () => {
    const handedTo = (sessionId: string | null): EvenKeelState => {
      const state = stateWith()
      const current = state.chain.active[0]!.current!
      state.chain.active[0]!.current = { ...current, sessionId }
      return state
    }

    it('never shows the old session\'s action, context or agent while the new one has no transcript yet', () => {
      const state = badgeStateOf(handedTo('s-2'), ABC, { now, fields: ALL_BADGE_FIELDS, stats: null })
      expect(state.active).toEqual([{ key: 'ABC-4', startedAt: '2026-11-09T11:30:00Z', state: 'working' }])
    })

    it('still finds the task\'s session by the task while the chain has no session id at all', () => {
      const state = badgeStateOf(handedTo(null), ABC, { now, fields: ['action', 'context'], stats: null })
      expect(state.active[0]).toMatchObject({ action: { tool: 'mcp__x__y' }, context: 25 })
    })
  })

  describe('the session\'s own status line (BTN-932)', () => {
    const withStatus = (at: string): EvenKeelState => {
      const state = stateWith({ feed: [tool('Bash npm test', { tool: 'Bash', text: 'Bash Run the tests' })] })
      Object.assign(state.sessions[0]!, { badgeStatus: { text: 'Writing tests for the scale', at } })
      return state
    }
    const actionOf = (state: EvenKeelState, statusOk?: (text: string) => boolean) => badgeStateOf(state, ABC, { now, fields: ['action'], stats: null, statusOk }).active[0]?.action

    it('shows a fresh status in place of the action\'s text and keeps the tool', () => {
      expect(actionOf(withStatus('2026-11-09T11:58:00Z'))).toEqual({ tool: 'Bash', text: 'Writing tests for the scale' })
    })

    it('goes back to the default action when the status is stale or the filter catches it', () => {
      expect(actionOf(withStatus('2026-11-09T11:55:00Z'))).toEqual({ tool: 'Bash', text: 'Bash Run the tests' })
      const seen: string[] = []
      expect(actionOf(withStatus('2026-11-09T11:58:00Z'), (text) => (seen.push(text), false))).toEqual({ tool: 'Bash', text: 'Bash Run the tests' })
      expect(seen).toEqual(['Writing tests for the scale'])
    })
  })

  it('leaves out every field not picked: no key at all, never null; never the tracker\'s own title', () => {
    const state = badgeStateOf(stateWith(), ABC, { now, fields: [], stats: { sessions: 3, medianCost: 1 }, titleEn: () => 'Draw the badge' })
    expect(state).toEqual({ v: 1, at: '2026-11-09T12:00:00.000Z', project: { key: 'ABC', name: 'Example' }, active: [{ key: 'ABC-4', state: 'working' }], chain: { state: 'running', next: 'ABC-5' } })
    expect(Object.hasOwn(state, 'milestone')).toBe(false)
    expect(Object.hasOwn(state, 'stats')).toBe(false)
    expect(JSON.stringify(badgeStateOf(stateWith(), ABC, { now, fields: ALL_BADGE_FIELDS, stats: null }))).not.toMatch(/Secret title|"title"/)
  })

  it('keeps only the picked numbers and drops the stats with none', () => {
    expect(badgeStateOf(stateWith(), ABC, { now, fields: ['medianMinutes'], stats: { sessions: 3, medianCost: 1, medianMinutes: 9 } }).stats).toEqual({ medianMinutes: 9 })
    expect(Object.hasOwn(badgeStateOf(stateWith(), ABC, { now, fields: ['sessions'], stats: {} }), 'stats')).toBe(false)
  })

  it('marks a session that asks as waiting, in its chip too', () => {
    const state = badgeStateOf(stateWith({ asking: true }), ABC, { now, fields: ['chain'], stats: null })
    expect(state.active[0]?.state).toBe('waiting')
    expect(state.chain.tasks).toContainEqual({ key: 'ABC-4', state: 'waiting' })
  })

  describe('a session on a spent limit (BTN-969)', () => {
    const hold = { at: '2026-11-09T11:50:00Z', account: 'john.doe@example.com', resetsAt: '2026-11-09T14:00:00Z', lastReplyAt: null, then: 'resume', acted: null }
    const limited = (limit: Record<string, unknown> | undefined, lamp = 'limit') => {
      const state = stateWith({ lamp, limit })
      Object.assign(state.sessions[0]!, { account: 'john.doe@example.com', badgeStatus: { text: 'Writing tests', at: '2026-11-09T11:59:00Z' } })
      return badgeStateOf(state, ABC, { now, fields: ALL_BADGE_FIELDS, stats: null })
    }

    it('waits for the reset: its time, no action, no status line, no account', () => {
      const state = limited(hold)
      expect(state.active).toEqual([{ key: 'ABC-4', agent: 'claude', model: 'opus', startedAt: '2026-11-09T11:30:00Z', state: 'limit', until: '2026-11-09T14:00:00Z', context: 25 }])
      expect(state.chain.tasks).toContainEqual({ key: 'ABC-4', state: 'limit' })
      expect(JSON.stringify(state)).not.toMatch(/john|example\.com|account|Writing tests/)
    })

    it('leaves the reset out when nobody knows it', () => {
      expect(limited({ ...hold, resetsAt: null }).active[0]).not.toHaveProperty('until')
      expect(limited(undefined).active[0]).toMatchObject({ state: 'limit' })
      expect(limited(undefined).active[0]).not.toHaveProperty('until')
    })

    it('is plain work again once the chain went on: after the reset or on another account', () => {
      expect(limited({ ...hold, acted: 'relay' }, 'working').active[0]).toMatchObject({ state: 'working', action: { tool: 'mcp__x__y', text: 'Writing tests' } })
      expect(limited(undefined, 'working').active[0]).not.toHaveProperty('until')
    })

    it('does not take a retry after an overload for a limit', () => {
      expect(limited({ ...hold, transient: true }, 'waiting').active[0]?.state).toBe('waiting')
    })
  })

  it('tells a paused, an idle and a stopped chain apart', () => {
    const of = (state: EvenKeelState) => badgeStateOf(state, ABC, { now, fields: [], stats: null }).chain
    expect(of(stateWith({ paused: true })).state).toBe('paused')
    expect(of(stateWith({ current: false }))).toEqual({ state: 'idle', next: 'ABC-4' })
    expect(of({ ...stateWith(), chain: { active: [], projects: {} } } as unknown as EvenKeelState)).toEqual({ state: 'stopped', next: null })
  })

  describe('close times and the milestone\'s parts (BTN-970)', () => {
    const tz = 'Europe/Berlin'
    const closedAt = (task: string, at: string) => ({ task, closedAt: at })

    it('picks the last done chips by the time the chain closed them, in the service\'s zone; undated ones stand first', () => {
      const closed = [closedAt('ABC-12', '2026-11-08T10:00:00Z'), closedAt('ABC-2', '2026-11-08T23:30:00Z'), closedAt('ABC-1', '2026-11-09T02:40:00Z')]
      const chips = badgeStateOf(stateWith(), ABC, { now, fields: ['chain'], stats: null, closed, tz }).chain.tasks!.filter((chip) => chip.state === 'done')
      expect(chips).toEqual([
        { key: 'ABC-14', state: 'done' },
        { key: 'ABC-15', state: 'done' },
        { key: 'ABC-12', state: 'done', doneAt: '2026-11-08T11:00:00+01:00' },
        { key: 'ABC-2', state: 'done', doneAt: '2026-11-09T00:30:00+01:00' },
        { key: 'ABC-1', state: 'done', doneAt: '2026-11-09T03:40:00+01:00' },
      ])
    })

    it('splits the open tasks into those the chain takes and those with the maintainer, with the forecast and the target', () => {
      const state = stateWith()
      state.tasks.push(task('ABC-7', 'Unstarted') as never)
      const target = state.tasks.find((each) => each.id === 'ABC-4')!
      target.milestone = { label: 'v1', targetDate: Date.parse('2026-11-20T09:00:00Z') } as never
      const closed = Array.from({ length: 7 }, (_, index) => closedAt(`ABC-${30 + index}`, new Date(now.getTime() - (index + 1) * 20 * 3_600_000).toISOString()))
      closed.push(closedAt('ABC-40', '2026-10-01T00:00:00Z'))
      const milestone = badgeStateOf(state, ABC, { now, fields: ['milestone'], stats: null, closed, tz }).milestone
      expect(milestone).toEqual({ name: 'v1', done: 2, left: 3, queued: 2, eta: '2026-11-11', target: '2026-11-20' })
    })

    it('has no forecast without a task closed in the last 7 days, and none to make once the queue is empty', () => {
      const old = [closedAt('ABC-1', '2026-10-01T00:00:00Z')]
      expect(badgeStateOf(stateWith(), ABC, { now, fields: ['milestone'], stats: null, closed: old, tz }).milestone).toEqual({ name: 'v1', done: 2, left: 2, queued: 2 })
      const idle = { ...stateWith({ current: false }), chain: { active: [{ project: ABC, paused: false, current: null }], projects: { [ABC]: { order: ['ABC-6'] } } } } as unknown as EvenKeelState
      const recent = [closedAt('ABC-1', '2026-11-09T10:00:00Z')]
      expect(badgeStateOf(idle, ABC, { now, fields: ['milestone'], stats: null, closed: recent, tz }).milestone).toEqual({ name: 'v2', done: 0, left: 1, queued: 1, eta: '2026-11-16' })
    })

    it('shows the milestone the chain closed last once it has nothing to take: every open task is with the maintainer', () => {
      const empty = { ...stateWith({ current: false }), chain: { active: [{ project: ABC, paused: false, current: null }], projects: { [ABC]: { order: [] } } } } as unknown as EvenKeelState
      const closed = [closedAt('ABC-11', '2026-11-08T10:00:00Z'), closedAt('ABC-2', '2026-11-09T10:00:00Z')]
      expect(badgeStateOf(empty, ABC, { now, fields: ['milestone'], stats: null, closed, tz }).milestone).toEqual({ name: 'v1', done: 2, left: 2, queued: 0 })
      expect(badgeStateOf(empty, ABC, { now, fields: ['milestone'], stats: null, tz }).milestone).toBeNull()
    })
  })
})
