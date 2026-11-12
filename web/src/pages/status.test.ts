import { describe, expect, it } from 'vitest'
import type { EvenKeelState } from '../../../src/state.js'
import type { TrackerHealth, TrackerView } from '../../../src/tracker/health.js'
import type { Check, Level } from '../layout/system.js'
import { openTasks, problemsOf, readLate, refreshedProjects, staleReaders, trackerProblem, trackerReason } from './status.js'

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

describe('readLate', () => {
  it('is quiet for a project read within three minutes', () => {
    expect(readLate(tracker({ 'p-abc': '2026-10-24T11:57:00Z' }), 'p-abc', now)).toBe(false)
  })

  it('marks a project not read for over three minutes, or never read by a live connection', () => {
    expect(readLate(tracker({ 'p-abc': '2026-10-24T11:48:00Z' }), 'p-abc', now)).toBe(true)
    expect(readLate(tracker({}), 'p-abc', now)).toBe(true)
  })

  it('marks any project of a connection that is down, however fresh its last read', () => {
    const down: TrackerHealth = { state: 'down', lastOkAt: '2026-10-24T11:59:00Z', error: 'timed out' }
    expect(readLate(tracker({ 'p-abc': '2026-10-24T11:59:00Z' }, down), 'p-abc', now)).toBe(true)
  })

  it('is quiet while the connection is still starting or off', () => {
    expect(readLate(tracker({}, { state: 'connecting', lastOkAt: null, error: null }), 'p-abc', now)).toBe(false)
    expect(readLate(tracker({}, { state: 'off', lastOkAt: null, error: null }), 'p-abc', now)).toBe(false)
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

describe('openTasks', () => {
  const task = (project: string, id: string, category: string) => ({ project, id, status: { name: category, category } })
  const state = {
    tasks: [task('p-abc', 'ABC-1', 'ToDo'), task('p-abc', 'ABC-2', 'Won'), task('p-ops', 'OPS-1', 'Started'), task('p-x', 'X-1', 'ToDo'), task('p-ops', 'OPS-2', 'Lost')],
  } as unknown as Pick<EvenKeelState, 'tasks'>

  it("counts the open tasks of the connection's projects, a closed one and another tracker's left out", () => {
    expect(openTasks(state, ['p-abc', 'p-ops'])).toBe(2)
    expect(openTasks(state, [])).toBe(0)
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

describe('trackerReason', () => {
  const down = (error: string, notice?: TrackerHealth['notice']): TrackerHealth => ({ state: 'down', lastOkAt: null, error, ...(notice && { notice }) })

  it('says a token without the issue scope by its notice, a 401 still as a refused key (BTN-788)', () => {
    const scope = { code: 'forgejo.scope', params: { scope: 'read:issue' } } as const
    expect(trackerReason(down('The Forgejo token lacks the read:issue scope.', scope))).toEqual(scope)
    expect(trackerReason(down('forgejo: the token is refused (HTTP 401)'))).toBe('denied')
  })

  it('has nothing to say about a tracker that is not down', () => {
    expect(trackerReason(live)).toBeNull()
  })
})
