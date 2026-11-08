import { describe, expect, it } from 'vitest'
import type { LaunchEntry } from '../chain/model.js'
import { notice } from '../notice/notice.js'
import type { EventsInput } from './page-events.js'
import { BLINK_MS, GRACE_MS, launchDraft, observe, settingsDrafts, stopDraft, watchedOf, type WatchInput } from './watch.js'

const none: WatchInput = {
  config: { shared: { ci: { guard: true, kinds: ['forgejo'] } }, projects: {} },
  chain: { active: [], projects: {}, leftovers: {}, skipped: {} },
  ci: {},
  fixes: {},
  sessions: [],
  tasks: [],
  forwards: {},
  works: {},
  cliVersions: [],
  packages: { gateway: null, projects: {} },
  account: { accounts: [], pool: [] },
  configError: null,
}
const chain = (fields: object = {}) => ({ project: 'p1', current: null, paused: false, error: null, ...fields }) as EventsInput['chain']['active'][number]
const withChain = (fields: object = {}): WatchInput => ({ ...none, chain: { ...none.chain, active: [chain(fields)] } })
const asking = (id: string): WatchInput =>
  ({ ...none, sessions: [{ task: 'ABC-1', sessionId: 's1', asking: true, ask: { id } }], tasks: [{ id: 'ABC-1', project: 'p1' }] }) as unknown as WatchInput
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 5, 12, minutes))

/** The entries the step from `before` to `after` writes, after a quiet first look at `before`. */
function step(before: WatchInput, after: WatchInput) {
  const first = observe(null, watchedOf(before), at(0))
  return observe(first.memory, watchedOf(after), at(1)).drafts
}

describe('observe', () => {
  it('takes the first look as old news and writes what comes after it', () => {
    const first = observe(null, watchedOf(asking('q1')), at(0))
    expect(first.drafts).toEqual([])
    expect(observe(first.memory, watchedOf(asking('q1')), at(1)).drafts).toEqual([])
    expect(step(none, asking('q1'))).toEqual([
      { level: 'warning', notice: notice('eventLog.ask', { task: 'ABC-1' }), place: { view: 'ask', project: 'p1', task: 'ABC-1' } },
    ])
  })

  it('gives each kind of event its level and place', () => {
    const red = { ...none, fixes: { p1: [{ id: 'ABC-FIX.1', red: 'abc1234def', at: '2026-11-05T11:00:00Z', end: null }] } } as WatchInput
    expect(step(none, red)).toEqual([
      { level: 'error', notice: notice('eventLog.red', { project: 'p1', commit: 'abc1234', cis: [] }), place: { view: 'ci', project: 'p1' } },
    ])
    expect(step(none, withChain({ limitUntil: '2026-11-05T14:00:00Z' }))).toEqual([
      { level: 'info', notice: notice('eventLog.chainStarted', { project: 'p1' }), place: { view: 'project', project: 'p1' } },
      { level: 'warning', notice: notice('eventLog.limit', { project: 'p1' }), place: { view: 'project', project: 'p1' } },
    ])
    const hold = notice('forward.conflict', { from: 'p1', into: 'p2', files: ['a.ts'] })
    expect(step(none, { ...none, forwards: { p1: { into: 'p2', behind: 2, hold, held: true } } } as WatchInput)).toEqual([
      { level: 'error', notice: notice('eventLog.conflict', { project: 'p1', into: 'p2' }), place: { view: 'project', project: 'p1' } },
    ])
  })

  it('writes the same question again only when the session asks a new one', () => {
    const first = observe(null, watchedOf(asking('q1')), at(0))
    const quiet = observe(first.memory, watchedOf(none), at(1))
    expect(quiet.drafts).toEqual([])
    expect(observe(quiet.memory, watchedOf(asking('q2')), at(2)).drafts).toHaveLength(1)
  })

  it('writes an event gone and back as a new one, unless it blinked out of one read', () => {
    const conflict = { ...none, forwards: { p1: { into: 'p2', behind: 2, hold: notice('forward.conflict', { from: 'p1', into: 'p2', files: ['a.ts'] }), held: true } } } as WatchInput
    const first = observe(null, watchedOf(none), at(0))
    const came = observe(first.memory, watchedOf(conflict), at(1))
    const gone = observe(came.memory, watchedOf(none), at(2))
    expect(observe(gone.memory, watchedOf(conflict), at(7)).drafts.map((each) => each.notice.code)).toEqual(['eventLog.conflict'])
    const blink = new Date(at(2).getTime() + BLINK_MS - 1)
    expect(observe(gone.memory, watchedOf(conflict), blink).drafts).toEqual([])
    // A blink is counted from the first read without it, not from when it was last seen.
    const later = observe(gone.memory, watchedOf(none), at(3))
    expect(observe(later.memory, watchedOf(conflict), new Date(at(3).getTime() + 1)).drafts).toHaveLength(1)
  })

  it('gives the conditions remembered over a restart the grace after the start, and only them', () => {
    const conflict = { ...none, forwards: { p1: { into: 'p2', behind: 2, hold: notice('forward.conflict', { from: 'p1', into: 'p2', files: ['a.ts'] }), held: true } } } as WatchInput
    const restored = { keys: new Set(['conflict|p1|p2']), until: at(0).getTime() + GRACE_MS }
    const start = observe({ seen: { 'conflict|p1|p2': at(0).toISOString() }, chains: {} }, watchedOf(none), at(0), restored)
    expect(observe(start.memory, watchedOf(conflict), at(9), restored).drafts).toEqual([])
    const after = observe(start.memory, watchedOf(none), at(10), restored)
    expect(observe(after.memory, watchedOf(conflict), at(11), restored).drafts).toHaveLength(1)
    const ask = observe(observe(start.memory, watchedOf(asking('q1')), at(1), restored).memory, watchedOf(none), at(2), restored)
    expect(observe(ask.memory, watchedOf(asking('q1')), at(3), restored).drafts).toHaveLength(1)
  })

  it('writes a CI that comes to hold the chain once more, as an error', () => {
    const view = (kind: string, status: string) => ({ kind, remote: kind, current: { commit: 'abc1234', title: '', manual: false, tasks: [], runs: [{ run: { id: 1, commit: 'abc1234', status }, jobs: [] }] } })
    const optional = { ...none, ci: { p1: [view('forgejo', 'success'), view('github', 'failure')] } } as unknown as WatchInput
    const both = { ...none, ci: { p1: [view('forgejo', 'failure'), view('github', 'failure')] } } as unknown as WatchInput
    expect(step(none, optional).map((each) => [each.notice.code, each.level])).toEqual([['eventLog.ciRed', 'warning']])
    expect(step(optional, both).map((each) => [each.notice.code, each.level])).toEqual([['eventLog.red', 'error']])
    expect(step(both, optional)).toEqual([])
  })

  it('writes a chain started, paused, resumed and stopped, and a pause on an error as one', () => {
    expect(step(withChain(), withChain({ paused: true })).map((each) => [each.notice.code, each.level])).toEqual([['eventLog.chainPaused', 'info']])
    expect(step(withChain({ paused: true }), withChain()).map((each) => each.notice.code)).toEqual(['eventLog.chainResumed'])
    expect(step(withChain(), none).map((each) => each.notice.code)).toEqual(['eventLog.chainStopped'])
    const error = notice('chain.empty', { project: 'p1' })
    expect(step(withChain(), withChain({ paused: true, error }))).toEqual([
      { level: 'error', notice: notice('eventLog.chainHeld', { project: 'p1' }, { cause: error }), place: { view: 'project', project: 'p1' } },
    ])
    expect(step(withChain({ paused: true }), withChain({ paused: true, error })).map((each) => each.notice.code)).toEqual(['eventLog.chainHeld'])
  })

  it('leaves a pause on the limit or a red main to their own entries, and a fix-only chain out', () => {
    const limit = notice('chain.limitSpent', { until: '20:00' })
    expect(step(withChain(), withChain({ paused: true, error: limit })).map((each) => each.notice.code)).toEqual(['eventLog.limit'])
    const check = notice('check.fixNotStarted', { commit: 'abc1234' })
    expect(step(withChain(), withChain({ paused: true, error: check })).map((each) => each.notice.code)).toEqual(['eventLog.red'])
    expect(step(none, withChain({ fixOnly: true }))).toEqual([])
  })

  it('writes a CLI on a version not checked, a gateway that does not listen and settings that do not parse', () => {
    const cli = { agent: 'claude', account: null, installed: '2.2.0', checked: '2.1.0', notice: notice('text', { text: 'claude 2.2.0' }) }
    const gateway = notice('text', { text: 'gateway down' })
    const config = notice('text', { text: 'broken' })
    const daemon = { ...cli, account: 'global', notice: notice('text', { text: 'daemon 2.2.0' }) }
    expect(step(none, { ...none, cliVersions: [cli, daemon], packages: { gateway, projects: {} }, configError: config })).toEqual([
      { level: 'warning', notice: cli.notice, place: { view: 'settings', project: null } },
      { level: 'warning', notice: daemon.notice, place: null },
      { level: 'error', notice: gateway, place: null },
      { level: 'error', notice: config, place: { view: 'settings', project: null } },
    ])
  })

  it('writes the problems of a project\'s packages that do not pass by themselves, as errors while they hold the chain', () => {
    const cell = (problems: object[], enabled = true) => ({ choice: null, enabled, settings: {}, problems })
    const packages = (blocked: boolean, cells: object, problems: object[] = []) =>
      ({ ...none, packages: { gateway: null, projects: { p1: { cells, problems, blocked, tracker: null } } } }) as unknown as WatchInput
    const place = { view: 'packages', project: 'p1' }
    expect(step(none, packages(true, { huly: cell([{ kind: 'notInstalled' }]) }, [{ kind: 'noTrackerMcp', server: 'huly' }]))).toEqual([
      { level: 'error', notice: notice('eventLog.packages', { project: 'p1', problem: 'noTrackerMcp', detail: 'huly' }), place },
      { level: 'error', notice: notice('eventLog.packages', { project: 'p1', package: 'huly', problem: 'notInstalled', detail: '' }), place },
    ])
    expect(step(none, packages(false, { kb: cell([{ kind: 'noKey', variables: ['KB_TOKEN', 'KB_URL'] }]) }))).toEqual([
      { level: 'warning', notice: notice('eventLog.packages', { project: 'p1', package: 'kb', problem: 'noKey', detail: 'KB_TOKEN, KB_URL' }), place },
    ])
    const failed = notice('text', { text: 'npm failed' })
    expect(step(none, packages(true, { kb: cell([{ kind: 'installFailed', notice: failed }]) }))[0]!.notice).toEqual(
      notice('eventLog.packages', { project: 'p1', package: 'kb', problem: 'installFailed', detail: '' }, { cause: failed }),
    )
    const passing = { a: cell([{ kind: 'installing' }]), b: cell([{ kind: 'probing' }]), c: cell([{ kind: 'unsupported', agent: 'codex' }]), d: cell([{ kind: 'notInstalled' }], false) }
    expect(step(none, packages(true, passing))).toEqual([])
  })

  it('writes the accounts of a pool whose limits are not read, as the usage banner tones them', () => {
    const entry = (key: string, state: string, fields: object = {}) => ({ key, needsLogin: false, usage: { state, reason: null, since: '2026-11-05T11:00:00Z' }, ...fields })
    const accounts = (list: object[], pool = ['a', 'b', 'c', 'd', 'e']) => ({ ...none, account: { accounts: list, pool: pool.map((account) => ({ account })) } }) as unknown as WatchInput
    const reason = notice('text', { text: 'no answer' })
    const list = [entry('a', 'unread', { usage: { state: 'unread', reason, since: '2026-11-05T11:00:00Z' } }), entry('b', 'off'), entry('c', 'ok'), entry('d', 'unread', { needsLogin: true }), entry('x', 'off')]
    expect(step(none, accounts(list))).toEqual([
      { level: 'warning', notice: notice('eventLog.usageUnread', { account: 'a' }, { cause: reason }), place: { view: 'accounts' } },
      { level: 'error', notice: notice('eventLog.usageOff', { account: 'b' }), place: { view: 'accounts' } },
    ])
    const again = [entry('a', 'unread', { usage: { state: 'unread', reason: null, since: '2026-11-05T12:00:00Z' } })]
    expect(step(accounts([entry('a', 'unread')]), accounts(again))).toHaveLength(1)
  })

  it('says whether what it remembers changed, not only when it was last seen', () => {
    const first = observe(null, watchedOf(asking('q1')), at(0))
    expect(first.changed).toBe(true)
    expect(observe(first.memory, watchedOf(asking('q1')), at(1)).changed).toBe(false)
    expect(observe(first.memory, watchedOf(none), at(1)).changed).toBe(false)
    expect(observe(first.memory, watchedOf(withChain()), at(1)).changed).toBe(true)
  })
})

describe('settingsDrafts', () => {
  const raw = (shared: object, projects: object[]) => ({ version: 28, ...shared, projects })
  const p1 = { id: 'p1', key: 'ABC', repo: 'D:/abc' }

  it('writes Even Keel\'s settings and each project changed, added or removed', () => {
    expect(settingsDrafts(raw({}, [p1]), raw({}, [p1]))).toEqual([])
    expect(settingsDrafts(raw({}, [p1]), raw({ parallel: 2 }, [p1]))).toEqual([
      { level: 'info', notice: notice('eventLog.settings', {}), place: { view: 'settings', project: null } },
    ])
    expect(settingsDrafts(raw({}, [p1]), raw({}, [{ ...p1, branch: 'dev' }]))).toEqual([
      { level: 'info', notice: notice('eventLog.projectSettings', { project: 'p1' }), place: { view: 'settings', project: 'p1' } },
    ])
    const p2 = { id: 'p2', key: 'XYZ', repo: 'D:/xyz' }
    expect(settingsDrafts(raw({}, [p1]), raw({}, [p2]))).toEqual([
      { level: 'info', notice: notice('eventLog.projectAdded', { project: 'p2' }), place: { view: 'project', project: 'p2' } },
      { level: 'info', notice: notice('eventLog.projectRemoved', { key: 'ABC' }), place: null },
    ])
  })
})

describe('launchDraft', () => {
  it('writes a session launched for a task, and no release or outcome of the launch log', () => {
    expect(launchDraft({ at: '2026-11-05T12:00:00Z', project: 'p1', task: 'ABC-1', sessionId: 's1' })).toEqual({
      level: 'info',
      notice: notice('eventLog.launch', { task: 'ABC-1' }),
      place: { view: 'task', project: 'p1', task: 'ABC-1' },
    })
    expect(launchDraft({ at: '2026-11-05T12:00:00Z', project: 'p1', task: 'ABC-1', sessionId: 's1', reason: 'skip' })).toBeNull()
  })

  it('writes a fix of main or a carry as a session of the project, not of a task named so (BTN-781)', () => {
    expect(launchDraft({ at: '2026-11-05T12:00:00Z', project: 'p1', task: 'ABC-FIX', sessionId: 's2' })).toEqual({
      level: 'info',
      notice: notice('eventLog.fixLaunch', { project: 'p1' }),
      place: { view: 'project', project: 'p1' },
    })
    expect(launchDraft({ at: '2026-11-05T12:00:00Z', project: 'p1', task: 'ABC-FIX.2', sessionId: 's3' })?.notice).toEqual(notice('eventLog.fixLaunch', { project: 'p1' }))
    expect(launchDraft({ at: '2026-11-05T12:00:00Z', project: 'p1', task: 'EKR-CARRY', sessionId: 's4' })).toEqual({
      level: 'info',
      notice: notice('eventLog.carryLaunch', { project: 'p1' }),
      place: { view: 'project', project: 'p1' },
    })
  })

  const at = '2026-11-07T23:40:00Z'
  const task = (entry: Partial<LaunchEntry>) => launchDraft({ at, project: 'p1', task: 'ABC-1', sessionId: 's1', ...entry })

  it('writes the same session going on as continued, with what moved it (BTN-853)', () => {
    expect(task({ reason: 'answer', previous: 's1' })).toEqual({
      level: 'info',
      notice: notice('eventLog.continued', { task: 'ABC-1', why: 'answer' }),
      place: { view: 'task', project: 'p1', task: 'ABC-1' },
    })
    expect(task({ reason: 'resume', previous: 's1' })?.notice).toEqual(notice('eventLog.continued', { task: 'ABC-1', why: 'resume' }))
    expect(task({ reason: 'resume', cause: 'limit', previous: 's1' })?.notice).toEqual(notice('eventLog.continued', { task: 'ABC-1', why: 'limit' }))
    expect(task({ reason: 'resume', cause: 'credit', previous: 's1' })?.notice).toEqual(notice('eventLog.continued', { task: 'ABC-1', why: 'credit' }))
    expect(task({ reason: 'resume', cause: 'mainFixed', previous: 's1' })?.notice).toEqual(notice('eventLog.continued', { task: 'ABC-1', why: 'mainFixed' }))
    expect(task({ reason: 'resume', cause: 'transient', previous: 's1' })?.notice).toEqual(notice('eventLog.continued', { task: 'ABC-1', why: 'transient' }))
    expect(task({ reason: 'review', previous: 's1' })?.notice).toEqual(notice('eventLog.continued', { task: 'ABC-1', why: 'review' }))
    expect(task({ reason: 'restart', previous: 's1' })?.notice).toEqual(notice('eventLog.continued', { task: 'ABC-1' }))
  })

  it('writes a new session in place of the previous one as a handoff, with its cause (BTN-853)', () => {
    expect(task({ sessionId: 's2', reason: 'checkpoint', previous: 's1' })).toEqual({
      level: 'info',
      notice: notice('eventLog.handoff', { task: 'ABC-1', why: 'checkpoint' }),
      place: { view: 'task', project: 'p1', task: 'ABC-1' },
    })
    expect(task({ sessionId: 's2', reason: 'restart', previous: 's1' })?.notice).toEqual(notice('eventLog.handoff', { task: 'ABC-1', why: 'restart' }))
    expect(task({ sessionId: 's2', reason: 'restart', cause: 'message', previous: 's1' })?.notice).toEqual(notice('eventLog.handoff', { task: 'ABC-1', why: 'message' }))
    expect(task({ sessionId: 's2', reason: 'relay', cause: 'mainFixed', previous: 's1' })?.notice).toEqual(notice('eventLog.handoff', { task: 'ABC-1', why: 'mainFixed' }))
    expect(task({ sessionId: 's2', reason: 'review', cause: 'review', previous: 's1' })?.notice).toEqual(notice('eventLog.handoff', { task: 'ABC-1', why: 'review' }))
    expect(task({ sessionId: 's2', reason: 'relay', previous: 's1' })?.notice).toEqual(notice('eventLog.handoff', { task: 'ABC-1' }))
  })

  it('writes a session started on pull request feedback, with no previous one, as a launch', () => {
    expect(task({ reason: 'review' })?.notice).toEqual(notice('eventLog.launch', { task: 'ABC-1' }))
  })

  it('writes a pull request opened on the session\'s mark as sent for review, not as a launch (BTN-863)', () => {
    expect(task({ reason: 'opened' })).toEqual({
      level: 'info',
      notice: notice('eventLog.reviewOpened', { task: 'ABC-1' }),
      place: { view: 'task', project: 'p1', task: 'ABC-1' },
    })
  })
})

describe('stopDraft', () => {
  it('names the task of a stopped session, and the project for a fix of main or a carry (BTN-781)', () => {
    expect(stopDraft('p1', 'ABC-1')).toEqual({ level: 'info', notice: notice('eventLog.stopped', { task: 'ABC-1' }), place: { view: 'project', project: 'p1' } })
    expect(stopDraft('p1', 'ABC-FIX.1')).toEqual({ level: 'info', notice: notice('eventLog.fixStopped', { project: 'p1' }), place: { view: 'project', project: 'p1' } })
    expect(stopDraft('p1', 'EKR-CARRY')).toEqual({ level: 'info', notice: notice('eventLog.carryStopped', { project: 'p1' }), place: { view: 'project', project: 'p1' } })
  })
})
