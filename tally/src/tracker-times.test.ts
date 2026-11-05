import { describe, expect, it } from 'vitest'
import type { TimeTracker } from '../../src/stats/tally.js'
import type { TaskSource, TimeEntry } from '../../src/tracker/source.js'
import { REPORT_DESCRIPTION } from './huly.js'
import { reportTrackerTimes } from './tracker-times.js'

const gitlab: TimeTracker = { kind: 'gitlab', values: { GITLAB_TOKEN: 'example' }, places: { p1: { key: 'APP', value: 'group/app' } }, prefixes: ['APP'] }
const jira: TimeTracker = { kind: 'jira', values: { JIRA_URL: 'https://example.atlassian.net' }, places: { p2: { key: 'ABC' }, p3: { key: 'XYZ' } }, prefixes: ['ABC', 'XYZ'] }
const report = (task: string, hours = 0.5) => ({ task, hours, date: '2026-11-01T10:00:00.000Z' })

function fakeTrackers(answers: Record<string, boolean | Error>) {
  const written: { kind: string; id: string; entry: TimeEntry }[] = []
  const connected: string[] = []
  let closed = 0
  const connect = async (tracker: TimeTracker): Promise<TaskSource> => {
    connected.push(tracker.kind)
    return {
      logTime: async (id: string, entry: TimeEntry) => {
        const answer = answers[id] ?? true
        if (answer instanceof Error) throw answer
        written.push({ kind: tracker.kind, id, entry })
        return answer
      },
      close: async () => {
        closed++
      },
    } as unknown as TaskSource
  }
  return { connect, written, connected, closed: () => closed }
}

describe('reportTrackerTimes', () => {
  it("writes each task's time through the profile of its project's prefix, signed like Huly's", async () => {
    const fake = fakeTrackers({})
    const lines: string[] = []
    const done = await reportTrackerTimes([report('APP-1', 0.29), report('ABC-2'), report('OTHER-3')], [gitlab, jira], (line) => lines.push(line), fake.connect)
    expect(done).toEqual(new Map([['APP-1', 0.29], ['ABC-2', 0.5]]))
    expect(fake.written).toEqual([
      { kind: 'gitlab', id: 'APP-1', entry: { hours: 0.29, at: '2026-11-01T10:00:00.000Z', summary: REPORT_DESCRIPTION } },
      { kind: 'jira', id: 'ABC-2', entry: { hours: 0.5, at: '2026-11-01T10:00:00.000Z', summary: REPORT_DESCRIPTION } },
    ])
    expect(fake.closed()).toBe(2)
    expect(lines).toEqual([])
  })

  it('connects to no tracker without a report of its projects', async () => {
    const fake = fakeTrackers({})
    expect(await reportTrackerTimes([report('ABC-2')], [gitlab, jira], () => {}, fake.connect)).toEqual(new Map([['ABC-2', 0.5]]))
    expect(fake.connected).toEqual(['jira'])
  })

  it('marks the tasks of a project that refuses time as needing no report, with one log line per project', async () => {
    const fake = fakeTrackers({ 'ABC-1': false, 'ABC-2': false, 'XYZ-3': true })
    const lines: string[] = []
    const done = await reportTrackerTimes([report('ABC-1'), report('ABC-2'), report('XYZ-3')], [jira], (line) => lines.push(line), fake.connect)
    expect(done).toEqual(new Map([['ABC-1', null], ['ABC-2', null], ['XYZ-3', 0.5]]))
    expect(lines).toEqual(['tally: Jira refuses time in ABC (time tracking off, or no right to log work): its tasks get no time report'])
  })

  it('keeps what was written before a failure and leaves the rest to the next run', async () => {
    const fake = fakeTrackers({ 'ABC-2': new Error('jira: HTTP 500') })
    const lines: string[] = []
    const done = await reportTrackerTimes([report('ABC-1'), report('ABC-2'), report('ABC-3')], [jira], (line) => lines.push(line), fake.connect)
    expect(done).toEqual(new Map([['ABC-1', 0.5]]))
    expect(lines).toEqual(['tally: Jira time reports of ABC, XYZ not written: jira: HTTP 500'])
    expect(fake.closed()).toBe(1)
  })

  it('logs a tracker it cannot connect to and goes on with the others', async () => {
    const lines: string[] = []
    const fake = fakeTrackers({})
    const connect = async (tracker: TimeTracker) => {
      if (tracker.kind === 'gitlab') throw new Error('gitlab: the token is refused (HTTP 401)')
      return await fake.connect(tracker)
    }
    const done = await reportTrackerTimes([report('APP-1'), report('ABC-2')], [gitlab, jira], (line) => lines.push(line), connect)
    expect(done).toEqual(new Map([['ABC-2', 0.5]]))
    expect(lines).toEqual(['tally: GitLab time reports of APP not written: gitlab: the token is refused (HTTP 401)'])
  })
})
