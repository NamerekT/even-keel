import { describe, expect, it } from 'vitest'
import type { EvenKeelState } from '../../../src/state.js'
import type { TrackerHealth, TrackerView } from '../../../src/tracker/health.js'
import type { Check, Level } from '../layout/system.js'
import { problemsOf, refreshedProjects, staleReaders, trackerProblem } from './status.js'

const now = new Date('2026-10-24T12:00:00Z')
const live: TrackerHealth = { state: 'live', lastOkAt: '2026-10-24T12:00:00Z', error: null }
const tracker = (readAt: Record<string, string>, health = live): TrackerView => ({
  name: 'huly-1',
  kind: 'huly',
  title: 'Huly · example',
  projects: ['p-abc', 'p-ops', 'feed-1'],
  ready: true,
  health,
  readAt,
})
const check = (key: string, level: Level): Check => ({ key, name: key, level, text: '', details: [] })

describe('problemsOf', () => {
  it('lists the failing checks before the warning ones, each in the page order', () => {
    const checks = [check('server', 'ok'), check('huly', 'warn'), check('linear', 'error'), check('limits', 'off'), check('tally', 'error')]
    expect(problemsOf(checks).map((each) => each.key)).toEqual(['linear', 'tally', 'huly'])
  })

  it('finds none when all are fine or off', () => {
    expect(problemsOf([check('server', 'ok'), check('tally', 'off')])).toEqual([])
  })
})

describe('staleReaders', () => {
  it('marks only the readers not read for over three minutes, and those never read', () => {
    const stale = staleReaders(tracker({ 'p-abc': '2026-10-24T11:59:50Z', 'p-ops': '2026-10-24T11:48:00Z' }), now)
    expect([...stale]).toEqual([
      ['p-ops', '2026-10-24T11:48:00Z'],
      ['feed-1', null],
    ])
  })

  it('keeps a read three minutes old unmarked', () => {
    expect(staleReaders(tracker({ 'p-abc': '2026-10-24T11:57:00Z', 'p-ops': '2026-10-24T11:57:00Z', 'feed-1': '2026-10-24T11:57:00Z' }), now).size).toBe(0)
  })

  it('marks nothing while the connection is down: its head says so', () => {
    const down: TrackerHealth = { state: 'down', lastOkAt: '2026-10-24T11:48:00Z', error: 'timed out' }
    expect(staleReaders(tracker({ 'p-abc': '2026-10-24T11:48:00Z' }, down), now).size).toBe(0)
  })
})

describe('refreshedProjects', () => {
  const state = {
    projects: ['p-abc', 'p-ops'],
    config: { feeds: { 'p-abc': [{ id: 'feed-1', key: 'GH' }] } },
  } as unknown as Pick<EvenKeelState, 'projects' | 'config'>

  it('reads each project once, a feed through its project', () => {
    expect(refreshedProjects(state, tracker({}))).toEqual(['p-abc', 'p-ops'])
  })

  it('skips a reader of no known project', () => {
    expect(refreshedProjects(state, { ...tracker({}), projects: ['gone'] })).toEqual([])
  })
})

describe('trackerProblem', () => {
  it('tells a refused key from a timeout, an unreachable host and the rest', () => {
    expect(trackerProblem('linear: 401 Unauthorized')).toBe('denied')
    expect(trackerProblem('GitHub answered: Bad credentials')).toBe('denied')
    expect(trackerProblem('huly: call timed out after 15000 ms')).toBe('timeout')
    expect(trackerProblem('getaddrinfo ENOTFOUND huly.example.com')).toBe('unreachable')
    expect(trackerProblem('fetch failed')).toBe('unreachable')
    expect(trackerProblem('huly: unknown project ABC')).toBe('other')
  })
})
