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

function stateWith(overrides: { asking?: boolean; paused?: boolean; current?: boolean; feed?: FeedLine[] } = {}): EvenKeelState {
  const current = overrides.current ?? true
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
      active: [{ project: ABC, paused: overrides.paused ?? false, current: current ? { task: 'ABC-4', sessionId: 's-1', since: '2026-11-09T11:30:00Z' } : null }],
      projects: { [ABC]: { order: ['ABC-4', 'ABC-5', 'ABC-6'] } },
    },
    sessions: [
      {
        sessionId: 's-1',
        task: 'ABC-4',
        agent: 'claude',
        model: 'opus',
        lamp: 'working',
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
      milestone: { name: 'v1', done: 2, left: 2 },
      stats: { sessions: 3, medianCost: 1.5, medianMinutes: 12 },
    })
  })

  it('takes the latest tool line\'s own badge text', () => {
    const state = badgeStateOf(stateWith({ feed: [tool('Grep x'), tool('Edit C:/repo/src/a.ts', { tool: 'Edit', text: 'Edit src/a.ts' })] }), ABC, { now, fields: ['action'], stats: null })
    expect(state.active[0]?.action).toEqual({ tool: 'Edit', text: 'Edit src/a.ts' })
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

  it('tells a paused, an idle and a stopped chain apart', () => {
    const of = (state: EvenKeelState) => badgeStateOf(state, ABC, { now, fields: [], stats: null }).chain
    expect(of(stateWith({ paused: true })).state).toBe('paused')
    expect(of(stateWith({ current: false }))).toEqual({ state: 'idle', next: 'ABC-4' })
    expect(of({ ...stateWith(), chain: { active: [], projects: {} } } as unknown as EvenKeelState)).toEqual({ state: 'stopped', next: null })
  })
})
