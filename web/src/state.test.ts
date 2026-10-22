import { describe, expect, it } from 'vitest'
import { notice, textNotice, type Notice } from '../../src/notice/notice.js'
import { fakeTask } from '../../src/tracker/fixture.js'
import { setLanguage } from './i18n/index.js'
import { FAKE_SHARED, fakeConfig } from './live/fakeConfig.js'
import type { StatusCategory, Task } from '../../src/tracker/model.js'
import type { AccountEntry, AccountLogin, AccountView } from '../../src/account/model.js'
import type { EvenKeelState, ProjectTask, SessionView } from '../../src/state.js'
import type { ActiveChain, CurrentTask, ProjectOrder } from '../../src/chain/dispatcher.js'
import type { TaskSession } from '../../src/chain/launches.js'
import {
  accountBadge,
  accountOrder,
  entryBadge,
  headerAccounts,
  limitedUntil,
  backlogTasks,
  blockMetered,
  canReady,
  loginLeft,
  cardTask,
  openQuestions,
  chainBlocks,
  chainControls,
  chainProgress,
  chainStatus,
  contextFill,
  fixBlockOf,
  issueLink,
  projectSlot,
  projectSlots,
  projectTracker,
  projectPage,
  projectOfPath,
  projectPath,
  questionPath,
  queuedAfter,
  readyButton,
  sessionElapsed,
  sessionStart,
  startsNow,
  cacheFreshness,
  cacheTone,
  taskLinks,
  taskPrefix,
  taskProject,
  tokenTotal,
  usageNotice,
  waitingSessions,
} from './state.js'

setLanguage('ru')

function view(task: string, lamp: SessionView['lamp'], lastActivityAt: string | null): SessionView {
  return {
    task,
    sessionId: `session-${task}`,
    agent: 'claude',
    model: null,
    cwd: 'C:\\repos\\example',
    branch: null,
    lamp,
    checkpoint: false,
    waitingFor: null,
    startupDialog: null,
    hungSince: null,
    asking: false,
    ask: null,
    apiError: null,
    startedAt: '2026-01-01T09:00:00.000Z',
    lastActivityAt,
    contextTokens: 0,
    contextWindow: null,
    cache: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    stage: null,
    action: null,
    feed: [],
    remoteUrl: null,
    remoteOff: null,
    account: null,
  }
}

/** A task of the project its prefix names: each project's id is its key here, except where a case is about the two. */
function task(id: string, category: StatusCategory = 'Active', blockedBy: string[] = []): ProjectTask {
  return { project: taskPrefix(id), ...fakeTask(id, { status: { name: category, category }, blockedBy }) }
}

function stateOf(patch: Partial<EvenKeelState>): EvenKeelState {
  return {
    startedAt: '2026-01-01T08:00:00.000Z',
    projects: ['ABC', 'XYZ'],
    projectKeys: { ABC: 'ABC', XYZ: 'XYZ' },
    projectLabels: { ABC: 'ABC', XYZ: 'XYZ' },
    taskPrefixes: { ABC: 'ABC', XYZ: 'XYZ' },
    config: { shared: FAKE_SHARED, projects: {}, trackers: [], trackerLocked: [] },
    chain: { active: [], parallel: 1, queue: [], projects: {}, skipped: {}, leftovers: {} },
    tasks: [],
    sessions: [],
    limits: null,
    usage: { state: 'ok', reason: null, since: null },
    account: { active: 'global', accounts: [], login: null, loginBlock: null, apps: [], pool: [], missing: [] },
    trackers: [{ name: 'huly', kind: 'huly', title: 'Huly', projects: ['ABC', 'XYZ'], ready: true, health: { state: 'live', lastOkAt: null, error: null }, readAt: {} }],
    trackerUrls: { default: null, projects: {}, pages: {} },
    ci: {},
    remotes: {},
    pullReadiness: {},
    launches: [],
    taskSessions: {},
    fixes: {},
    context: { window: 600_000, warn: 50, danger: 80 },
    configError: null,
    packages: { gateway: null, packages: [], projects: {}, keys: [], available: [], marketplace: null, imports: {} },
    secrets: { variables: [], sessionsPending: false },
    profiles: { profiles: [], kinds: [] },
    language: null,
    unattended: false,
    trimTools: true,
    tally: 'local',
    updates: { current: '0.1.0', available: null, toast: false, notes: [], blocked: null, previous: null, progress: null, result: null },
    cliVersions: [],
    fallbacks: [],
    mailbox: {},
    changelogs: {},
    forwards: {},
    ...patch,
  }
}

type ChainPatch = Omit<Partial<EvenKeelState['chain']>, 'active'> & { active?: ActiveChain | ActiveChain[] | null }

const chain = ({ active = [], ...patch }: ChainPatch): EvenKeelState['chain'] => ({
  active: active === null ? [] : Array.isArray(active) ? active : [active],
  parallel: 1,
  queue: [],
  projects: {},
  skipped: {},
  leftovers: {},
  ...patch,
})

describe('waitingSessions', () => {
  it('keeps only the sessions waiting for an answer, the longest waiting first', () => {
    const sessions = [
      view('ABC-1', 'working', '2026-01-01T10:00:00.000Z'),
      view('ABC-2', 'waiting', '2026-01-01T10:30:00.000Z'),
      view('DEMO-3', 'waiting', '2026-01-01T10:10:00.000Z'),
      view('DEMO-4', 'error', '2026-01-01T10:00:00.000Z'),
      view('DEMO-5', 'finished', '2026-01-01T09:00:00.000Z'),
    ]
    const tasks = ['ABC-1', 'ABC-2', 'DEMO-3', 'DEMO-4', 'DEMO-5'].map((id) => task(id))
    expect(waitingSessions(sessions, tasks).map((session) => session.task)).toEqual(['DEMO-3', 'ABC-2'])
  })

  it('leaves out sessions whose task is closed or no longer among the open ones', () => {
    const sessions = [
      view('ABC-1', 'waiting', '2026-01-01T10:00:00.000Z'),
      view('ABC-2', 'waiting', '2026-01-01T10:00:00.000Z'),
      view('ABC-3', 'waiting', '2026-01-01T10:00:00.000Z'),
    ]
    const tasks = [task('ABC-1'), task('ABC-2', 'Won')]
    expect(waitingSessions(sessions, tasks).map((session) => session.task)).toEqual(['ABC-1'])
  })

  it('falls back to the start time when a session has no activity yet', () => {
    const sessions = [view('ABC-1', 'waiting', '2026-01-01T09:30:00.000Z'), view('ABC-2', 'waiting', null)]
    expect(waitingSessions(sessions, [task('ABC-1'), task('ABC-2')]).map((session) => session.task)).toEqual([
      'ABC-2',
      'ABC-1',
    ])
  })

  it('counts a waiting fix session of a red main, which has no task', () => {
    const sessions = [view('ABC-FIX', 'waiting', '2026-01-01T10:00:00.000Z'), view('XYZ-FIX', 'working', null)]
    expect(waitingSessions(sessions, []).map((session) => session.task)).toEqual(['ABC-FIX'])
  })

  it('leaves out a session that ended its turn on a checkpoint: it waits for a handover, not for an answer', () => {
    const sessions = [{ ...view('ABC-1', 'waiting', null), checkpoint: true }, view('ABC-2', 'waiting', null)]
    expect(waitingSessions(sessions, [task('ABC-1'), task('ABC-2')]).map((session) => session.task)).toEqual(['ABC-2'])
  })
})

describe('taskProject', () => {
  it('takes the prefix off a task id or the name of a fix session without a state', () => {
    expect(taskPrefix('ABC-12')).toBe('ABC')
    expect(taskProject(null, 'MY_KEY2-3')).toBe('MY_KEY2')
    expect(taskProject(null, 'ABC-FIX')).toBe('ABC')
  })

  it('finds the project of two that share a key: by the task it lists, by the fix name, else the first of the prefix (BTN-271)', () => {
    const state = stateOf({
      projects: ['id-a', 'id-b'],
      projectKeys: { 'id-a': 'ABC', 'id-b': 'ABC' },
      taskPrefixes: { 'id-a': 'ABC', 'id-b': 'ABC' },
      tasks: [{ ...task('ABC-7'), project: 'id-b' }],
    })
    expect(taskProject(state, 'ABC-7')).toBe('id-b')
    expect(taskProject(state, 'ABC-8')).toBe('id-a')
    expect(taskProject(state, 'ABC-FIX')).toBe('id-a')
    expect(taskProject(state, 'ABC_IDB-FIX')).toBe('id-b')
    expect(taskProject(state, 'NOPE-1')).toBe('NOPE')
  })
})

describe('openQuestions', () => {
  it('counts open tasks labelled as a question, leaving closed ones out', () => {
    const tasks = [
      { ...task('ABC-1', 'Won'), question: true },
      { ...task('ABC-2', 'ToDo'), question: true },
      { ...task('ABC-3', 'Active'), question: true },
      { ...task('ABC-4', 'Lost'), question: true },
      task('ABC-5', 'ToDo'),
    ]
    expect(openQuestions(tasks)).toBe(2)
  })
})

describe('project paths', () => {
  it('name a project by its id', () => {
    expect(projectPath('id-abc')).toBe('/p/id-abc')
  })

  it('read the project from its id and from the key of an older link, the first project of the key', () => {
    const state = stateOf({ projects: ['id-a', 'id-b', 'id-x'], projectKeys: { 'id-a': 'ABC', 'id-b': 'ABC', 'id-x': 'XYZ' } })
    expect(projectOfPath(state, 'id-b')).toEqual({ project: 'id-b', byKey: false })
    expect(projectOfPath(state, 'ABC')).toEqual({ project: 'id-a', byKey: true })
    expect(projectOfPath(state, 'nothing')).toEqual({ project: 'nothing', byKey: false })
  })
})

describe('questionPath', () => {
  const question = (id: string, category: StatusCategory = 'ToDo'): ProjectTask => ({ ...task(id, category), question: true })
  const order = (ids: string[], waiting: string[] = []) => ({ order: ids, waiting, backlog: [], error: null })

  it('leads to the session of the only open question', () => {
    const state = stateOf({
      tasks: [task('ABC-1'), question('ABC-2')],
      sessions: [view('ABC-2', 'waiting', null)],
      chain: chain({ projects: { ABC: order(['ABC-1', 'ABC-2']) } }),
    })
    expect(questionPath(state, ['ABC', 'XYZ'])).toBe('/p/ABC#ABC-2')
  })

  it('takes the first question in chain order, across projects in page order', () => {
    const state = stateOf({
      tasks: [question('ABC-2'), question('ABC-3'), question('XYZ-1')],
      sessions: [view('ABC-2', 'waiting', null), view('ABC-3', 'working', null), view('XYZ-1', 'waiting', null)],
      chain: chain({ projects: { ABC: order(['ABC-3', 'ABC-2']), XYZ: order(['XYZ-1']) } }),
    })
    expect(questionPath(state, ['ABC', 'XYZ'])).toBe('/p/ABC#ABC-3')
    expect(questionPath(state, ['XYZ', 'ABC'])).toBe('/p/XYZ#XYZ-1')
    expect(questionPath(state, ['XYZ'])).toBe('/p/XYZ#XYZ-1')
  })

  it('leads to the project page while no question has a session: ahead in the chain, held back or in the backlog', () => {
    const state = stateOf({
      tasks: [question('ABC-1'), question('ABC-2'), question('ABC-3', 'UnStarted')],
      sessions: [view('ABC-2', 'finished', null)],
      chain: chain({ projects: { ABC: { ...order(['ABC-1'], ['ABC-2']), backlog: ['ABC-3'] } } }),
    })
    expect(questionPath(state, ['ABC'])).toBe('/p/ABC')
  })

  it('passes a question without a session for a later one that has it', () => {
    const state = stateOf({
      tasks: [question('ABC-1'), question('XYZ-1'), question('XYZ-2')],
      sessions: [view('XYZ-2', 'waiting', null)],
      chain: chain({ projects: { ABC: order(['ABC-1']), XYZ: order(['XYZ-1', 'XYZ-2']) } }),
    })
    expect(questionPath(state, ['ABC', 'XYZ'])).toBe('/p/XYZ#XYZ-2')
  })

  it('counts a question whose session is only starting', () => {
    const state = stateOf({
      tasks: [question('ABC-1')],
      chain: chain({
        active: { project: 'ABC', current: { task: 'ABC-1', sessionId: null, since: '2026-01-01T08:00:00.000Z' }, paused: false, error: null },
        projects: { ABC: order(['ABC-1']) },
      }),
    })
    expect(questionPath(state, ['ABC'])).toBe('/p/ABC#ABC-1')
  })

  it('is null without open questions, whatever sessions the closed ones left', () => {
    const state = stateOf({
      tasks: [question('ABC-1', 'Won'), task('ABC-2')],
      sessions: [view('ABC-1', 'finished', null), view('ABC-2', 'working', null)],
      chain: chain({ projects: { ABC: order(['ABC-2']) } }),
    })
    expect(questionPath(state, ['ABC', 'XYZ'])).toBeNull()
  })
})

describe('chainProgress', () => {
  it('counts done tasks against the done ones and the chain, the backlog apart', () => {
    const tasks = [
      task('ABC-1', 'Won'),
      task('ABC-2', 'Won'),
      task('ABC-3', 'Lost'),
      task('ABC-4'),
      task('ABC-5', 'ToDo'),
      task('ABC-6', 'UnStarted'),
      task('ABC-7', 'UnStarted'),
      task('ABC-8', 'UnStarted'),
    ]
    const order = { order: ['ABC-5', 'ABC-4'], waiting: ['ABC-6'], backlog: ['ABC-7', 'ABC-8'], error: null }
    expect(chainProgress(tasks, order)).toEqual({ done: 2, total: 5, backlog: 2 })
  })

  it('counts only the done tasks before the chain is loaded', () => {
    expect(chainProgress([task('ABC-1', 'Won'), task('ABC-2', 'UnStarted')], undefined)).toEqual({ done: 1, total: 1, backlog: 0 })
  })

  it('is zero of zero with no tasks', () => {
    expect(chainProgress([], undefined)).toEqual({ done: 0, total: 0, backlog: 0 })
  })
})

describe('backlogTasks', () => {
  it('lists the backlog of the project in the order the server gives', () => {
    const state = stateOf({
      tasks: [task('ABC-12', 'UnStarted'), task('ABC-3', 'UnStarted'), task('ABC-4')],
      chain: chain({ projects: { ABC: { order: ['ABC-4'], waiting: [], backlog: ['ABC-3', 'ABC-12'], error: null } } }),
    })
    expect(backlogTasks(state, 'ABC').map((each) => each.id)).toEqual(['ABC-3', 'ABC-12'])
  })

  it('is empty before the chain is loaded', () => {
    expect(backlogTasks(stateOf({ tasks: [task('ABC-1', 'UnStarted')] }), 'ABC')).toEqual([])
  })
})

describe('taskLinks', () => {
  const ids = (items: { id: string }[]) => items.map((item) => item.id)

  it('lists the open blockers of a task and the open tasks waiting for it, by number', () => {
    const links = taskLinks(
      [task('ABC-1'), task('ABC-10', 'ToDo'), task('ABC-2', 'Won'), task('ABC-3', 'ToDo', ['ABC-10', 'ABC-1', 'ABC-2']), task('ABC-4', 'ToDo', ['ABC-3'])],
      [],
    )
    expect(ids(links('ABC-3').blockers)).toEqual(['ABC-1', 'ABC-10'])
    expect(ids(links('ABC-3').dependents)).toEqual(['ABC-4'])
    expect(ids(links('ABC-1').dependents)).toEqual(['ABC-3'])
  })

  it('leaves closed tasks out of the waiting ones', () => {
    const links = taskLinks([task('ABC-1'), task('ABC-2', 'Lost', ['ABC-1']), task('ABC-3', 'Won', ['ABC-1'])], [])
    expect(links('ABC-1').dependents).toEqual([])
  })

  it('gives a closed or unknown task no links', () => {
    const links = taskLinks([task('ABC-1'), task('ABC-2', 'Won', ['ABC-1']), task('ABC-3', 'ToDo', ['ABC-2'])], [])
    expect(links('ABC-2')).toEqual({ blockers: [], dependents: [] })
    expect(links('ABC-9')).toEqual({ blockers: [], dependents: [] })
  })

  it('keeps a blocker it does not know, without a title', () => {
    const links = taskLinks([task('ABC-1', 'ToDo', ['XYZ-5'])], [])
    expect(links('ABC-1').blockers).toEqual([{ id: 'XYZ-5', title: null, lamp: 'ahead' }])
  })

  it('lights a linked task by its status and session, as its chain block is lit', () => {
    const tasks = [task('ABC-1'), task('ABC-2'), task('ABC-3', 'ToDo', ['ABC-1', 'ABC-2'])]
    const links = taskLinks(tasks, [view('ABC-1', 'waiting', null)])
    expect(links('ABC-3').blockers.map((item) => item.lamp)).toEqual(['waiting', 'ahead'])
    expect(links('ABC-3').blockers[0]!.title).toBe(task('ABC-1').title)
  })

  it('lights a backlog task apart from one ahead in the chain', () => {
    const tasks = [task('ABC-1', 'ToDo'), task('ABC-2', 'UnStarted'), task('ABC-3', 'ToDo', ['ABC-1', 'ABC-2'])]
    const links = taskLinks(tasks, [])
    expect(links('ABC-3').blockers.map((item) => item.lamp)).toEqual(['ahead', 'backlog'])
  })
})

describe('canReady', () => {
  const tracker = (ready: boolean) => ({ name: 'huly', kind: 'huly', title: 'Huly', projects: ['ABC'], ready, health: { state: 'live' as const, lastOkAt: null, error: null }, readAt: {} })

  it('is true when the tracker of the project can move a task to Todo', () => {
    expect(canReady(stateOf({ trackers: [tracker(true)] }), 'ABC')).toBe(true)
  })

  it('is false when the tracker cannot or the project has no tracker', () => {
    expect(canReady(stateOf({ trackers: [tracker(false)] }), 'ABC')).toBe(false)
    expect(canReady(stateOf({ trackers: [tracker(true)] }), 'XYZ')).toBe(false)
  })
})

describe('readyButton', () => {
  const tracker = (ready: boolean) => ({ name: 'huly', kind: 'huly', title: 'Huly', projects: ['ABC'], ready, health: { state: 'live' as const, lastOkAt: null, error: null }, readAt: {} })
const later = notice('order.later', { task: 'ABC-2', milestone: 'v0.1', blocker: 'ABC-8', blockerMilestone: 'v0.2' })
  const stateWith = (ready: boolean) =>
    stateOf({
      trackers: [tracker(ready)],
      chain: chain({
        projects: {
          ABC: { order: ['ABC-2'], waiting: ['ABC-7', 'ABC-8', 'XYZ-1'], backlog: ['ABC-5'], landing: { 'ABC-5': null, 'ABC-7': 'ABC-2' }, refused: { 'ABC-8': later }, error: null },
        },
      }),
    })

  it('shows on a backlog task and on a locked blocker the chain would take', () => {
    expect(readyButton(stateWith(true), 'ABC', { id: 'ABC-5', stage: 'UnStarted', locked: false })).toEqual({ refused: null })
    expect(readyButton(stateWith(true), 'ABC', { id: 'ABC-7', stage: 'UnStarted', locked: true })).toEqual({ refused: null })
  })

  it('is off with the reason when the move would leave the chain without an order', () => {
    expect(readyButton(stateWith(true), 'ABC', { id: 'ABC-8', stage: 'UnStarted', locked: true })).toEqual({ refused: later })
  })

  it('is not there for a locked blocker the chain would not take, a task past the backlog or a tracker that cannot move it', () => {
    expect(readyButton(stateWith(true), 'ABC', { id: 'XYZ-1', stage: 'UnStarted', locked: true })).toBeNull()
    expect(readyButton(stateWith(true), 'ABC', { id: 'ABC-7', stage: 'ToDo', locked: true })).toBeNull()
    expect(readyButton(stateWith(false), 'ABC', { id: 'ABC-5', stage: 'UnStarted', locked: false })).toBeNull()
  })
})

describe('chainStatus', () => {
  const active = (patch: { paused?: boolean; error?: Notice | null; limitUntil?: string } = {}) => ({
    project: 'ABC',
    current: null,
    paused: patch.paused ?? false,
    error: patch.error ?? null,
    ...(patch.limitUntil === undefined ? {} : { limitUntil: patch.limitUntil }),
  })

  it('tells a running chain from a paused one', () => {
    expect(chainStatus(chain({ active: active() }), 'ABC')).toEqual({ kind: 'running', limitUntil: null })
    expect(chainStatus(chain({ active: active({ paused: true }) }), 'ABC')).toEqual({ kind: 'paused', error: null })
    expect(chainStatus(chain({ active: active({ paused: true, error: textNotice('boom') }) }), 'ABC')).toEqual({
      kind: 'paused',
      error: textNotice('boom'),
    })
  })

  it('tells when a running chain waits for the limit to reset', () => {
    expect(chainStatus(chain({ active: active({ limitUntil: '2026-09-27T17:49:00.000Z' }) }), 'ABC')).toEqual({
      kind: 'running',
      limitUntil: '2026-09-27T17:49:00.000Z',
    })
    expect(chainStatus(chain({ active: active({ paused: true, limitUntil: '2026-09-27T17:49:00.000Z' }) }), 'ABC')).toEqual({
      kind: 'paused',
      error: null,
    })
  })

  it('tells when a running chain waits for a free slot', () => {
    const wait = { notice: textNotice('no slot is free for ABC-1'), at: '2026-09-27T17:49:00.000Z' }
    expect(chainStatus(chain({ active: { ...active(), slotWait: wait } }), 'ABC')).toEqual({
      kind: 'running',
      limitUntil: null,
      slotWait: textNotice('no slot is free for ABC-1'),
    })
  })

  it('tells when a running chain waits for the CI of main', () => {
    const ciWait = { commit: '0123456789abcdef', since: '2026-09-27T17:49:00.000Z' }
    expect(chainStatus(chain({ active: { ...active(), ciWait } }), 'ABC')).toEqual({ kind: 'running', limitUntil: null, ciWait })
  })

  it('gives a queued chain its place in the queue, counting from one', () => {
    expect(chainStatus(chain({ active: active(), queue: ['DEMO', 'XYZ'] }), 'XYZ')).toEqual({ kind: 'queued', position: 2 })
  })

  it('calls any other chain idle', () => {
    expect(chainStatus(chain({ active: active(), queue: ['DEMO'] }), 'XYZ')).toEqual({ kind: 'idle' })
  })

  it('tells each of several active chains by its own state', () => {
    const both = chain({ active: [active(), { ...active({ paused: true }), project: 'XYZ' }], parallel: 2 })
    expect(chainStatus(both, 'ABC')).toEqual({ kind: 'running', limitUntil: null })
    expect(chainStatus(both, 'XYZ')).toEqual({ kind: 'paused', error: null })
  })
})

describe('chainControls', () => {
  const order = (patch: Partial<ProjectOrder> = {}): ProjectOrder => ({ order: ['ABC-1'], waiting: [], backlog: [], error: null, ...patch })

  it('fills Stop while the chain runs and says why Resume is off', () => {
    expect(chainControls({ kind: 'running', limitUntil: null }, order())).toEqual({ enabled: ['stop'], primary: 'stop', off: 'running' })
  })

  it('fills Resume on a paused chain and leaves Stop pressable', () => {
    expect(chainControls({ kind: 'paused', error: null }, order())).toEqual({ enabled: ['resume', 'stop'], primary: 'resume', off: null })
  })

  it('fills Start on an idle chain that has tasks', () => {
    expect(chainControls({ kind: 'idle' }, order())).toEqual({ enabled: ['start'], primary: 'start', off: 'idle' })
  })

  it('fills nothing when no button can be pressed, and names the reason', () => {
    const none = { enabled: [], primary: null }
    expect(chainControls({ kind: 'queued', position: 1 }, order())).toEqual({ ...none, off: 'queued' })
    expect(chainControls({ kind: 'idle' }, undefined)).toEqual({ ...none, off: 'notLoaded' })
    expect(chainControls({ kind: 'idle' }, order({ error: textNotice('boom') }))).toEqual({ ...none, off: 'failed' })
    expect(chainControls({ kind: 'idle' }, order({ order: [] }))).toEqual({ ...none, off: 'empty' })
  })
})

describe('startsNow', () => {
  const running = (project: string) => ({ project, current: null, paused: false, error: null })

  it('starts a project at once while fewer chains than allowed are active', () => {
    expect(startsNow(chain({}))).toBe(true)
    expect(startsNow(chain({ active: running('ABC') }))).toBe(false)
    expect(startsNow(chain({ active: running('ABC'), parallel: 2 }))).toBe(true)
    expect(startsNow(chain({ active: [running('ABC'), running('XYZ')], parallel: 2 }))).toBe(false)
  })
})

describe('cardTask', () => {
  const orders = { ABC: { order: ['ABC-3', 'ABC-4'], waiting: [], backlog: [], error:null } }

  it('shows the current task of the active chain with the lamp of its session', () => {
    const state = stateOf({
      tasks: [task('ABC-3'), task('ABC-4')],
      sessions: [view('ABC-3', 'finished', null), view('ABC-3', 'waiting', null)],
      chain: chain({
        active: { project: 'ABC', current: { task: 'ABC-3', sessionId: 's', since: 't' }, paused: false, error: null },
        projects: orders,
      }),
    })
    expect(cardTask(state, 'ABC')).toEqual({ id: 'ABC-3', title: 'ABC-3', lamp: 'waiting', next: false })
  })

  it('shows the first task in order as the next one when nothing runs, grey without a session', () => {
    const state = stateOf({ tasks: [task('ABC-3'), task('ABC-4')], chain: chain({ projects: orders }) })
    expect(cardTask(state, 'ABC')).toEqual({ id: 'ABC-3', title: 'ABC-3', lamp: 'ahead', next: true })
  })

  it('passes over a skipped task when naming the next one', () => {
    const state = stateOf({ tasks: [task('ABC-3'), task('ABC-4')], chain: chain({ projects: orders, skipped: { ABC: ['ABC-3'] } }) })
    expect(cardTask(state, 'ABC')?.id).toBe('ABC-4')
  })

  it('passes over a task held by a blocker outside the chain', () => {
    const state = stateOf({
      tasks: [task('ABC-3', 'ToDo', ['ABC-9']), task('ABC-4'), task('ABC-9', 'UnStarted')],
      chain: chain({ projects: { ABC: { order: ['ABC-3', 'ABC-4'], waiting: ['ABC-9'], backlog: [], error: null } } }),
    })
    expect(cardTask(state, 'ABC')?.id).toBe('ABC-4')
  })

  it('shows a finished session of a task still open as stopped, not as done', () => {
    const state = stateOf({
      tasks: [task('ABC-3')],
      sessions: [view('ABC-3', 'finished', null)],
      chain: chain({ projects: orders }),
    })
    expect(cardTask(state, 'ABC')?.lamp).toBe('stopped')
  })

  it('lights the task as its chain block on the project page is lit', () => {
    const cases: SessionView[][] = [
      [],
      [view('ABC-3', 'working', null)],
      [view('ABC-3', 'waiting', null)],
      [view('ABC-3', 'finished', null)],
      [{ ...view('ABC-3', 'waiting', null), checkpoint: true }],
      [{ ...view('ABC-3', 'finished', null), checkpoint: true }],
      [view('ABC-3', 'limit', null)],
    ]
    for (const sessions of cases) {
      const state = stateOf({ tasks: [task('ABC-3'), task('ABC-4')], sessions, chain: chain({ projects: orders }) })
      expect(cardTask(state, 'ABC')?.lamp).toBe(chainBlocks(state, 'ABC').find((block) => block.id === 'ABC-3')?.lamp)
    }
  })

  it('shows the first task in order when every open one is held, naming why', () => {
    const state = stateOf({ tasks: [task('ABC-3'), task('ABC-4')], chain: chain({ projects: orders, skipped: { ABC: ['ABC-3', 'ABC-4'] } }) })
    expect(cardTask(state, 'ABC')).toEqual({ id: 'ABC-3', title: 'ABC-3', lamp: 'ahead', next: false, held: 'skipped' })
  })

  it('names a task held by a waiting blocker as blocked', () => {
    const state = stateOf({
      tasks: [task('ABC-3', 'ToDo', ['ABC-9']), task('ABC-9', 'UnStarted')],
      chain: chain({ projects: { ABC: { order: ['ABC-3'], waiting: ['ABC-9'], backlog: [], error: null } } }),
    })
    expect(cardTask(state, 'ABC')).toMatchObject({ id: 'ABC-3', held: 'blocked' })
  })

  it('names a task behind a skipped one as blocked', () => {
    const state = stateOf({
      tasks: [task('ABC-3'), task('ABC-4', 'ToDo', ['ABC-3'])],
      chain: chain({ projects: orders, skipped: { ABC: ['ABC-3'] } }),
    })
    expect(cardTask(state, 'ABC')).toMatchObject({ id: 'ABC-3', held: 'skipped' })
  })

  it('has no task when the chain is empty or not built yet', () => {
    expect(cardTask(stateOf({ chain: chain({ projects: { ABC: { order: [], waiting: [], backlog: [], error:null } } }) }), 'ABC')).toBeNull()
    expect(cardTask(stateOf({}), 'ABC')).toBeNull()
  })

  it('keeps a task Huly has not delivered yet, without a title', () => {
    const state = stateOf({ chain: chain({ projects: orders }) })
    expect(cardTask(state, 'ABC')).toEqual({ id: 'ABC-3', title: null, lamp: 'ahead', next: true })
  })

  it('shows the fix session of a red main as the current work, under its own title', () => {
    const state = stateOf({
      tasks: [task('ABC-3'), task('ABC-4')],
      sessions: [view('ABC-FIX', 'working', null)],
      chain: chain({
        active: { project: 'ABC', current: { task: 'ABC-FIX', sessionId: 's', since: 't' }, paused: false, error: null },
        projects: orders,
      }),
    })
    expect(cardTask(state, 'ABC')).toEqual({ id: 'ABC-FIX', title: 'Починка main', lamp: 'working', next: false })
  })
})

describe('projectSlot', () => {
  it('takes the color of the project settings, not its place', () => {
    const state = stateOf({})
    state.config.projects = { ABC: { ...fakeConfig().projects.ABC!, color: 5 }, XYZ: { ...fakeConfig().projects.XYZ!, color: null } }
    expect(projectSlot(state, 'ABC')).toBe(5)
    expect(projectSlot(state, 'XYZ')).toBeNull()
    expect(projectSlot(state, 'ZZZ')).toBeNull()
    expect(projectSlots(state)).toEqual({ ABC: 5, XYZ: null })
  })
})

describe('projectTracker', () => {
  const github = { name: 'work', kind: 'github', title: 'GitHub · work', projects: ['XYZ'], ready: true, health: { state: 'live' as const, lastOkAt: null, error: null }, readAt: {} }

  it('names the tracker as its view does', () => {
    expect(projectTracker(stateOf({}), 'ABC')).toEqual({ kind: 'huly', label: 'Huly' })
  })

  it('adds the tracker project when there is one', () => {
    const projects = { XYZ: { trackerProject: 'example/repo' } as EvenKeelState['config']['projects'][string] }
    const state = stateOf({ config: { shared: FAKE_SHARED, projects, trackers: [], trackerLocked: [] }, trackers: [github] })
    expect(projectTracker(state, 'XYZ')).toEqual({ kind: 'github', label: 'GitHub · work · example/repo' })
  })

  it('is null for a project no tracker reads', () => {
    expect(projectTracker(stateOf({ trackers: [] }), 'ABC')).toBeNull()
  })
})

describe('projectPage', () => {
  const urls = { default: null, projects: {}, pages: { ABC: 'https://huly.example.com/workbench/example/tracker/abc-id/issues', XYZ: null } }
  const config = { shared: FAKE_SHARED, projects: {}, trackers: [{ name: 'huly', title: 'Huly', projectKey: null }], trackerLocked: [] }

  it('gives the page with the name of the tracker it is in, not of the profile', () => {
    const state = stateOf({ config, trackerUrls: urls, trackers: [{ ...stateOf({}).trackers[0]!, title: 'Huly · example' }] })
    expect(projectPage(state, 'ABC')).toEqual({ url: urls.pages.ABC, tracker: 'Huly' })
  })

  it('is null without a page', () => {
    const state = stateOf({ config, trackerUrls: urls })
    expect(projectPage(state, 'XYZ')).toBeNull()
    expect(projectPage(state, 'OPS')).toBeNull()
  })

  it('names no tracker it does not know', () => {
    expect(projectPage(stateOf({ trackerUrls: urls }), 'ABC')).toEqual({ url: urls.pages.ABC, tracker: null })
  })
})

describe('chainBlocks', () => {
  const running =(current: string, paused = false) => ({
    project: 'ABC',
    current: { task: current, sessionId: 's', since: 't' },
    paused,
    error: null,
  })

  it('marks the tasks the chain skips', () => {
    const state = stateOf({
      tasks: [task('ABC-1', 'ToDo'), task('ABC-2', 'ToDo')],
      chain: chain({ projects: { ABC: { order: ['ABC-1', 'ABC-2'], waiting: [], backlog: [], error:null } }, skipped: { ABC: ['ABC-2'] } }),
    })
    expect(chainBlocks(state, 'ABC').map((block) => [block.id, block.skipped])).toEqual([
      ['ABC-1', false],
      ['ABC-2', true],
    ])
  })

  it('shows the tasks waiting on their pull requests between the closed tasks and the chain', () => {
    const pull = { task: 'ABC-2', number: 7, url: 'https://example.com/pulls/7', feedback: true }
    const state = stateOf({
      tasks: [task('ABC-1', 'Won'), task('ABC-2', 'Active'), task('ABC-3', 'ToDo')],
      chain: chain({ projects: { ABC: { order: ['ABC-3'], waiting: [], backlog: [], reviews: [pull], error: null } } }),
    })
    expect(chainBlocks(state, 'ABC').map((block) => [block.id, block.open, block.review ?? null])).toEqual([
      ['ABC-1', false, null],
      ['ABC-2', false, pull],
      ['ABC-3', true, null],
    ])
  })

  it('carries the sessions of each task and the pending limit of the current one', () => {
    const hold = {
      at: '2026-01-01T10:00:00.000Z',
      account: 'john@example.com',
      resetsAt: '2026-01-01T13:00:00.000Z',
      lastReplyAt: '2026-01-01T09:59:00.000Z',
      then: 'relay' as const,
      acted: null,
    }
    const rows = [{ sessionId: 's2', at: '2026-01-01T13:00:00.000Z', how: 'relay' as const, resumed: 0, answers: 0 }]
    const state = stateOf({
      tasks: [task('ABC-1', 'Active'), task('ABC-2', 'ToDo')],
      chain: chain({
        active: { ...running('ABC-1'), current: { task: 'ABC-1', sessionId: 's', since: 't', limit: hold } },
        projects: { ABC: { order: ['ABC-1', 'ABC-2'], waiting: [], backlog: [], error:null } },
      }),
      taskSessions: { 'ABC-1': rows },
    })
    const [first, second] = chainBlocks(state, 'ABC')
    expect(first).toMatchObject({ sessions: rows, limit: hold })
    expect(second).toMatchObject({ sessions: [], limit: null })

    const acted = stateOf({ ...state, chain: chain({ ...state.chain, active: { ...running('ABC-1'), current: { task: 'ABC-1', sessionId: 's', since: 't', limit: { ...hold, acted: 'relay' } } } }) })
    expect(chainBlocks(acted, 'ABC')[0]?.limit).toBeNull()
  })

  it('marks the tasks whose live session outlasted the stopped chain', () => {
    const loose = (state: EvenKeelState) => chainBlocks(state, 'ABC').filter((block) => block.loose).map((block) => block.id)
    const tasks = [task('ABC-1', 'Active'), task('ABC-2', 'ToDo'), task('ABC-3', 'ToDo')]
    const projects = { ABC: { order: ['ABC-1', 'ABC-2', 'ABC-3'], waiting: [], backlog: [], error: null } }
    const sessions = [view('ABC-1', 'working', null), view('ABC-2', 'finished', null), view('ABC-3', 'waiting', null)]
    expect(loose(stateOf({ tasks, sessions, chain: chain({ projects }) }))).toEqual(['ABC-1', 'ABC-3'])
    expect(loose(stateOf({ tasks, sessions, chain: chain({ active: running('ABC-1', true), projects }) }))).toEqual([])
  })

  it('shows the session at work while the answer goes to it, not stopped by the delivery', () => {
    const tasks = [task('ABC-1', 'Active')]
    const projects = { ABC: { order: ['ABC-1'], waiting: [], backlog: [], error: null } }
    const current = { task: 'ABC-1', sessionId: 'ABC-1-session', since: 't', starting: '2026-01-01T10:00:00.000Z', answering: true as const }
    const stopped = { ...view('ABC-1', 'finished', null), sessionId: 'ABC-1-session' }
    const [block] = chainBlocks(stateOf({ tasks, sessions: [stopped], chain: chain({ active: { ...running('ABC-1'), current }, projects }) }), 'ABC')
    expect(block).toMatchObject({ start: null, lamp: 'working', session: { lamp: 'working', ask: null }, answering: '2026-01-01T10:00:00.000Z' })
  })

  it('tells of no delivery once the answer reached the session', () => {
    const tasks = [task('ABC-1', 'Active')]
    const projects = { ABC: { order: ['ABC-1'], waiting: [], backlog: [], error: null } }
    const current = { task: 'ABC-1', sessionId: 'ABC-1-session', since: 't', resumedAt: '2026-01-01T10:00:00.000Z' }
    const [block] = chainBlocks(stateOf({ tasks, sessions: [view('ABC-1', 'working', null)], chain: chain({ active: { ...running('ABC-1'), current }, projects }) }), 'ABC')
    expect(block?.answering).toBeUndefined()
  })

  describe('the fix session of a red main', () => {
    const order = { ABC: { order: ['ABC-2', 'ABC-3'], waiting: [], backlog: [], error: null } }
    const tasks = [task('ABC-1', 'Won'), task('ABC-2', 'Active'), task('ABC-3', 'ToDo')]
    const stopped = { task: 'ABC-2', sessionId: 's2', since: 't', at: '2026-01-01T10:00:00.000Z', commit: 'a1b2c3d' }

    it('leads the open tasks as a block of its own, with its session and launches', () => {
      const rows = [{ sessionId: 's', at: '2026-01-01T10:01:00.000Z', how: 'launch' as const, resumed: 0, answers: 0 }]
      const session = view('ABC-FIX', 'working', null)
      const state = stateOf({
        tasks,
        sessions: [session],
        chain: chain({ active: { ...running('ABC-FIX'), interrupted: stopped }, projects: order }),
        taskSessions: { 'ABC-FIX.1': rows },
      })
      const blocks = chainBlocks(state, 'ABC')
      expect(blocks.map((block) => [block.id, block.current])).toEqual([
        ['ABC-1', false],
        ['ABC-FIX.1', true],
        ['ABC-2', false],
        ['ABC-3', false],
      ])
      expect(blocks[1]).toMatchObject({ title: 'Починка main', open: true, locked: false, lamp: 'working', session, sessions: rows })
      expect(blocks[1]?.milestone).toBe(blocks[2]?.milestone)
    })

    it('marks the task whose session made way for it', () => {
      const state = stateOf({ tasks, chain: chain({ active: { ...running('ABC-FIX'), interrupted: stopped }, projects: order }) })
      expect(chainBlocks(state, 'ABC').map((block) => [block.id, block.interrupted])).toEqual([
        ['ABC-1', undefined],
        ['ABC-FIX.1', undefined],
        ['ABC-2', true],
        ['ABC-3', undefined],
      ])
    })

    it('marks the task whose live session is set aside until it lands: the one the chain takes next', () => {
      const aside = (state: EvenKeelState) => chainBlocks(state, 'ABC').filter((block) => block.aside).map((block) => block.id)
      const sessions = [view('ABC-FIX', 'working', null), view('ABC-2', 'waiting', null), view('ABC-3', 'waiting', null)]
      const fixing = chain({ active: running('ABC-FIX'), projects: order })
      expect(aside(stateOf({ tasks, sessions, chain: fixing }))).toEqual(['ABC-2'])
      expect(aside(stateOf({ tasks, sessions, chain: { ...fixing, skipped: { ABC: ['ABC-2'] } } }))).toEqual(['ABC-3'])
      expect(aside(stateOf({ tasks, sessions: [sessions[0]!, view('ABC-2', 'finished', null)], chain: fixing }))).toEqual([])
      expect(aside(stateOf({ tasks, sessions, chain: chain({ active: { ...running('ABC-FIX'), interrupted: stopped }, projects: order }) }))).toEqual([])
      expect(aside(stateOf({ tasks, sessions, chain: chain({ active: running('ABC-2'), projects: order }) }))).toEqual([])
    })

    it('stays in the list while its session lives after the chain let it go, and leaves once it has finished', () => {
      const waiting = stateOf({ tasks, sessions: [view('ABC-FIX', 'waiting', null)], chain: chain({ active: running('ABC-2'), projects: order }) })
      expect(chainBlocks(waiting, 'ABC').map((block) => [block.id, block.current])).toEqual([
        ['ABC-1', false],
        ['ABC-FIX.1', false],
        ['ABC-2', true],
        ['ABC-3', false],
      ])
      const finished = stateOf({ ...waiting, sessions: [view('ABC-FIX', 'finished', null)] })
      expect(chainBlocks(finished, 'ABC').map((block) => block.id)).toEqual(['ABC-1', 'ABC-2', 'ABC-3'])
    })

    it('goes last when no task is open', () => {
      const state = stateOf({
        tasks: [task('ABC-1', 'Won')],
        chain: chain({ active: { ...running('ABC-FIX'), fixOnly: true }, projects: { ABC: { order: [], waiting: [], backlog: [], error: null } } }),
      })
      expect(chainBlocks(state, 'ABC').map((block) => block.id)).toEqual(['ABC-1', 'ABC-FIX.1'])
    })

    it('is absent while main is green', () => {
      const state = stateOf({ tasks, chain: chain({ active: running('ABC-2'), projects: order }) })
      expect(chainBlocks(state, 'ABC').map((block) => block.id)).toEqual(['ABC-1', 'ABC-2', 'ABC-3'])
    })
  })

  describe('the fixes of a red main that are over', () => {
    const order = { ABC: { order: ['ABC-2', 'ABC-3'], waiting: [], backlog: [], error: null } }
    const tasks = [task('ABC-1', 'Won'), task('ABC-4', 'Won'), task('ABC-2', 'Active'), task('ABC-3', 'ToDo')]
    const row = (at: string, sessionId = 's') => ({ sessionId, at, how: 'launch' as const, resumed: 0, answers: 0 })
    const landed = {
      id: 'ABC-FIX.1',
      red: 'c6b3956aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      at: '2026-01-01T09:30:00.000Z',
      end: { at: '2026-01-01T10:00:00.000Z', how: 'landed' as const, commit: '15945febbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
    }
    const dropped = { id: 'ABC-FIX.2', red: 'd00d000ccccccccccccccccccccccccccccccccc', at: '2026-01-01T11:30:00.000Z', end: { at: '2026-01-01T12:00:00.000Z', how: 'dropped' as const, commit: null } }
    const runs = { 'ABC-1': [row('2026-01-01T09:00:00.000Z')], 'ABC-4': [row('2026-01-01T11:00:00.000Z')], 'ABC-FIX.1': [row(landed.at, 'f1')], 'ABC-FIX.2': [row(dropped.at, 'session-ABC-FIX')] }
    const base = { tasks, taskSessions: runs, fixes: { ABC: [landed, dropped] }, chain: chain({ active: running('ABC-2'), projects: order }) }

    it('each stand among the closed tasks by the time it ended, as a row of its own with its sessions', () => {
      const blocks = chainBlocks(stateOf(base), 'ABC')
      expect(blocks.map((block) => [block.id, block.lamp, block.open])).toEqual([
        ['ABC-1', 'done', false],
        ['ABC-FIX.1', 'fixed', false],
        ['ABC-4', 'done', false],
        ['ABC-FIX.2', 'fixed', false],
        ['ABC-2', 'ahead', true],
        ['ABC-3', 'ahead', true],
      ])
      expect(blocks[1]).toMatchObject({ title: 'Починка main: c6b3956 → 15945fe', current: false, sessions: runs['ABC-FIX.1'], session: null, fix: landed })
      expect(blocks[3]?.title).toBe('Починка main: d00d000 — брошена, main остался как был')
    })

    it('names only the commit main went out at when the log did not keep the red one', () => {
      const state = stateOf({ ...base, fixes: { ABC: [{ ...landed, red: null }] } })
      expect(chainBlocks(state, 'ABC')[1]?.title).toBe('Починка main → 15945fe')
    })

    it('keeps the session that still lives after its fix was dropped on its row, and adds no live block for it', () => {
      const blocks = chainBlocks(stateOf({ ...base, sessions: [view('ABC-FIX', 'waiting', null)] }), 'ABC')
      expect(blocks.map((block) => block.id)).toEqual(['ABC-1', 'ABC-FIX.1', 'ABC-4', 'ABC-FIX.2', 'ABC-2', 'ABC-3'])
      expect(blocks[3]).toMatchObject({ lamp: 'fixed', session: { task: 'ABC-FIX', lamp: 'waiting' } })
    })

    it('take a link to the fix by its name to the row of its session: the live one first', () => {
      const lingering = chainBlocks(stateOf({ ...base, sessions: [view('ABC-FIX', 'waiting', null)] }), 'ABC')
      expect(fixBlockOf(lingering, 'ABC-FIX')).toBe('ABC-FIX.2')
      expect(fixBlockOf(lingering, 'ABC-FIX.1')).toBeNull()
      expect(fixBlockOf(lingering, 'ABC-2')).toBeNull()
      const live = chainBlocks(stateOf({ ...base, sessions: [view('ABC-FIX', 'working', null)], chain: chain({ active: running('ABC-FIX'), projects: order }) }), 'ABC')
      expect(fixBlockOf(live, 'ABC-FIX')).toBe('ABC-FIX.3')
    })

    it('leave the fix running now its own id after theirs', () => {
      const open = { id: 'ABC-FIX.3', red: 'e00e000', at: '2026-01-01T13:00:00.000Z', end: null }
      const state = stateOf({ ...base, fixes: { ABC: [landed, dropped, open] }, sessions: [view('ABC-FIX', 'working', null)], chain: chain({ active: running('ABC-FIX'), projects: order }) })
      expect(chainBlocks(state, 'ABC').map((block) => [block.id, block.lamp, block.current])).toEqual([
        ['ABC-1', 'done', false],
        ['ABC-FIX.1', 'fixed', false],
        ['ABC-4', 'done', false],
        ['ABC-FIX.2', 'fixed', false],
        ['ABC-FIX.3', 'working', true],
        ['ABC-2', 'ahead', false],
        ['ABC-3', 'ahead', false],
      ])
      const launching = stateOf({ ...base, chain: chain({ active: running('ABC-FIX'), projects: order }) })
      expect(chainBlocks(launching, 'ABC').find((block) => block.current)?.id).toBe('ABC-FIX.3')
    })
  })

  it('shows a waiting blocker from another project locked, with its title, before the task it holds', () => {
    const foreign = { ...task('XYZ-7', 'ToDo'), title: 'Foreign blocker' }
    const state = stateOf({
      tasks: [task('ABC-1', 'ToDo'), task('ABC-2', 'ToDo', ['XYZ-7'])],
      chain: chain({ projects: { ABC: { order: ['ABC-1', 'ABC-2'], waiting: ['XYZ-7'], outside: [foreign], backlog: [], error: null } } }),
    })
    expect(chainBlocks(state, 'ABC').map((block) => [block.id, block.title, block.locked])).toEqual([
      ['ABC-1', expect.anything(), false],
      ['XYZ-7', 'Foreign blocker', true],
      ['ABC-2', expect.anything(), false],
    ])
  })

  it('puts closed tasks first in blocking order, then the open ones in chain order', () => {
    const state = stateOf({
      tasks: [
        task('ABC-1', 'Won', ['ABC-2']),
        task('ABC-2', 'Won'),
        task('ABC-3', 'Lost'),
        task('ABC-4', 'ToDo'),
        task('ABC-5', 'ToDo'),
        task('XYZ-1', 'Won'),
      ],
      chain: chain({ projects: { ABC: { order: ['ABC-5', 'ABC-4'], waiting: [], backlog: [], error:null } } }),
    })
    expect(chainBlocks(state, 'ABC').map((block) => block.id)).toEqual(['ABC-2', 'ABC-1', 'ABC-3', 'ABC-5', 'ABC-4'])
  })

  it('puts closed tasks the chain ran after the others, by their last launch, so the one closed last stays next to the open ones', () => {
    const launch = (at: string) => ({ sessionId: `s-${at}`, at, how: 'launch' as const, resumed: 0, answers: 0 })
    const state = stateOf({
      tasks: [task('ABC-1', 'Won'), task('ABC-2', 'Won', ['ABC-1']), task('ABC-3', 'Won'), task('ABC-4', 'Lost'), task('ABC-5', 'ToDo')],
      chain: chain({ projects: { ABC: { order: ['ABC-5'], waiting: [], backlog: [], error:null } } }),
      taskSessions: {
        'ABC-1': [launch('2026-01-01T12:00:00.000Z')],
        'ABC-2': [launch('2026-01-01T13:00:00.000Z'), launch('2026-01-01T09:00:00.000Z')],
        'ABC-3': [launch('2026-01-01T10:00:00.000Z')],
      },
    })
    expect(chainBlocks(state, 'ABC').map((block) => block.id)).toEqual(['ABC-4', 'ABC-3', 'ABC-1', 'ABC-2', 'ABC-5'])
  })

  it('marks which tasks are open and carries their blockers', () => {
    const state = stateOf({
      tasks: [task('ABC-1', 'Won'), task('ABC-2', 'ToDo', ['ABC-1']), task('ABC-3', 'ToDo', ['ABC-2', 'XYZ-4'])],
      chain: chain({ projects: { ABC: { order: ['ABC-2', 'ABC-3'], waiting: [], backlog: [], error:null } } }),
    })
    expect(chainBlocks(state, 'ABC').map(({ id, open, blockedBy }) => ({ id, open, blockedBy }))).toEqual([
      { id: 'ABC-1', open: false, blockedBy: [] },
      { id: 'ABC-2', open: true, blockedBy: ['ABC-1'] },
      { id: 'ABC-3', open: true, blockedBy: ['ABC-2', 'XYZ-4'] },
    ])
  })

  it('carries the milestone label and what an open task must follow, blockers and earlier milestones alike', () => {
    const planned = (id: string, category: StatusCategory, label: string, blockedBy: string[] = []): ProjectTask => ({
      ...task(id, category, blockedBy),
      milestone: { label, targetDate: 0 },
    })
    const state = stateOf({
      tasks: [planned('ABC-1', 'Won', 'v0.1'), planned('ABC-2', 'ToDo', 'v0.1'), planned('ABC-3', 'ToDo', 'v0.2', ['ABC-4']), task('ABC-4', 'ToDo')],
      chain: chain({ projects: { ABC: { order: ['ABC-2', 'ABC-4', 'ABC-3'], waiting: [], backlog: [], error:null } } }),
    })
    expect(chainBlocks(state, 'ABC').map(({ id, milestone, after }) => ({ id, milestone, after }))).toEqual([
      { id: 'ABC-1', milestone: 'v0.1', after: [] },
      { id: 'ABC-2', milestone: 'v0.1', after: [] },
      { id: 'ABC-4', milestone: null, after: [] },
      { id: 'ABC-3', milestone: 'v0.2', after: ['ABC-4', 'ABC-2'] },
    ])
  })

  it('lights done green, canceled as canceled and open tasks without a session grey', () => {
    const state = stateOf({
      tasks: [task('ABC-1', 'Won'), task('ABC-2', 'Lost'), task('ABC-3', 'ToDo')],
      sessions: [view('ABC-1', 'finished', null)],
      chain: chain({ projects: { ABC: { order: ['ABC-3'], waiting: [], backlog: [], error:null } } }),
    })
    expect(chainBlocks(state, 'ABC').map((block) => block.lamp)).toEqual(['done', 'canceled', 'ahead'])
  })

  it('takes the lamp of an open task from its session, a finished one showing as stopped', () => {
    const ids = ['ABC-1', 'ABC-2', 'ABC-3', 'ABC-4', 'ABC-5']
    const state = stateOf({
      tasks: ids.map((id) => task(id)),
      sessions: [
        view('ABC-1', 'working', null),
        view('ABC-2', 'waiting', null),
        view('ABC-3', 'error', null),
        view('ABC-4', 'limit', null),
        view('ABC-5', 'finished', null),
      ],
      chain: chain({ projects: { ABC: { order: ids, waiting: [], backlog: [], error:null } } }),
    })
    expect(chainBlocks(state, 'ABC').map((block) => block.lamp)).toEqual(['working', 'waiting', 'error', 'limit', 'stopped'])
  })

  it('shows a task whose session ended on a checkpoint nobody took up as cut off at a handoff, live or not', () => {
    const ids = ['ABC-1', 'ABC-2', 'ABC-3']
    const state = stateOf({
      tasks: ids.map((id) => task(id)),
      sessions: [
        { ...view('ABC-1', 'waiting', null), checkpoint: true },
        { ...view('ABC-2', 'finished', null), checkpoint: true },
        { ...view('ABC-3', 'error', null), checkpoint: true },
      ],
      chain: chain({ projects: { ABC: { order: ids, waiting: [], backlog: [], error: null } } }),
    })
    expect(chainBlocks(state, 'ABC').map((block) => block.lamp)).toEqual(['handoff', 'handoff', 'error'])
  })

  it('tells only the current task that its session is starting', () => {
    const starting = { task: 'ABC-1', sessionId: null, since: '2026-01-01T10:00:00.000Z', starting: '2026-01-01T10:00:00.000Z' }
    const state = stateOf({
      tasks: [task('ABC-1'), task('ABC-2')],
      sessions: [view('ABC-2', 'working', null)],
      chain: chain({ active: { ...running('ABC-1'), current: starting }, projects: { ABC: { order: ['ABC-1', 'ABC-2'], waiting: [], backlog: [], error: null } } }),
    })
    const [first, second] = chainBlocks(state, 'ABC', new Date('2026-01-01T10:00:05.000Z'))
    expect(first?.start).toEqual({ phase: 'launch', since: '2026-01-01T10:00:00.000Z' })
    expect(second?.start).toBeNull()
  })

  it('prefers a live session over a finished one of the same task', () => {
    const state = stateOf({
      tasks: [task('ABC-1')],
      sessions: [view('ABC-1', 'finished', null), view('ABC-1', 'waiting', null)],
      chain: chain({ projects: { ABC: { order: ['ABC-1'], waiting: [], backlog: [], error:null } } }),
    })
    const [block] = chainBlocks(state, 'ABC')
    expect(block?.lamp).toBe('waiting')
    expect(block?.session?.lamp).toBe('waiting')
  })

  it('marks the current task of the active chain, paused or not, and only in its own project', () => {
    const tasks = [task('ABC-1'), task('ABC-2')]
    const projects = { ABC: { order: ['ABC-1', 'ABC-2'], waiting: [], backlog: [], error:null } }
    const current = (active: ActiveChain | null) =>
      chainBlocks(stateOf({ tasks, chain: chain({ active, projects }) }), 'ABC').map((block) => block.current)
    expect(current(running('ABC-1'))).toEqual([true, false])
    expect(current(running('ABC-1', true))).toEqual([true, false])
    expect(current({ ...running('ABC-1'), project: 'XYZ' })).toEqual([false, false])
    expect(current(null)).toEqual([false, false])
  })

  it('carries the title, status name and category, and keeps a task Huly has not delivered yet', () => {
    const state = stateOf({
      tasks: [{ project: 'ABC', ...fakeTask('ABC-1', { title: 'First', status: { name: 'In Progress', category: 'Active' } }) }],
      chain: chain({ projects: { ABC: { order: ['ABC-1', 'ABC-2'], waiting: [], backlog: [], error:null } } }),
    })
    expect(chainBlocks(state, 'ABC').map(({ id, title, status, stage }) => ({ id, title, status, stage }))).toEqual([
      { id: 'ABC-1', title: 'First', status: 'In Progress', stage: 'Active' },
      { id: 'ABC-2', title: null, status: null, stage: null },
    ])
  })

  it('marks a task labelled as a question, open or closed, and not one Huly has not delivered', () => {
    const state = stateOf({
      tasks: [{ ...task('ABC-1', 'Won'), question: true }, { ...task('ABC-2', 'ToDo'), question: true }, task('ABC-3', 'ToDo')],
      chain: chain({ projects: { ABC: { order: ['ABC-2', 'ABC-3', 'ABC-4'], waiting: [], backlog: [], error:null } } }),
    })
    expect(chainBlocks(state, 'ABC').map((block) => block.question)).toEqual([true, true, false, false])
  })

  it('shows a blocker outside the chain locked, right before the task it holds', () => {
    const state = stateOf({
      tasks: [task('ABC-1', 'Won'), task('ABC-2', 'ToDo', ['ABC-9']), task('ABC-3', 'ToDo'), task('ABC-9', 'UnStarted')],
      chain: chain({ projects: { ABC: { order: ['ABC-3', 'ABC-2'], waiting: ['ABC-9'], backlog: [], error: null } } }),
    })
    expect(chainBlocks(state, 'ABC').map(({ id, open, locked, status }) => ({ id, open, locked, status }))).toEqual([
      { id: 'ABC-1', open: false, locked: false, status: 'Won' },
      { id: 'ABC-3', open: true, locked: false, status: 'ToDo' },
      { id: 'ABC-9', open: false, locked: true, status: 'UnStarted' },
      { id: 'ABC-2', open: true, locked: false, status: 'ToDo' },
    ])
  })

  it('files a locked blocker under the milestone of the task it holds', () => {
    const state = stateOf({
      tasks: [{ ...task('ABC-2', 'ToDo', ['ABC-9']), milestone: { label: 'v0.2', targetDate: 0 } }, task('ABC-9', 'UnStarted')],
      chain: chain({ projects: { ABC: { order: ['ABC-2'], waiting: ['ABC-9'], backlog: [], error: null } } }),
    })
    expect(chainBlocks(state, 'ABC').map(({ id, milestone }) => ({ id, milestone }))).toEqual([
      { id: 'ABC-9', milestone: 'v0.2' },
      { id: 'ABC-2', milestone: 'v0.2' },
    ])
  })

  it('falls back to open tasks by number when the chain order is broken', () => {
    const state = stateOf({
      tasks: [task('ABC-10'), task('ABC-9'), task('ABC-1', 'Won')],
      chain: chain({ projects: { ABC: { order: [], waiting: [], backlog: [], error:textNotice('chain: cycle: ABC-9 → ABC-10 → ABC-9') } } }),
    })
    expect(chainBlocks(state, 'ABC').map((block) => block.id)).toEqual(['ABC-1', 'ABC-9', 'ABC-10'])
  })

  it('orders closed tasks by number when their links form a cycle', () => {
    const state = stateOf({ tasks: [task('ABC-2', 'Won', ['ABC-1']), task('ABC-1', 'Won', ['ABC-2'])] })
    expect(chainBlocks(state, 'ABC').map((block) => block.id)).toEqual(['ABC-1', 'ABC-2'])
  })
})

describe('contextFill', () => {
  const scale = { window: 600_000, warn: 50, danger: 80 }

  it('gives the share of the window in percent and the level by thresholds', () => {
    expect(contextFill(60_000, scale)).toEqual({ percent: 10, level: 'ok' })
    expect(contextFill(300_000, scale)).toEqual({ percent: 50, level: 'warn' })
    expect(contextFill(479_999, scale).level).toBe('warn')
    expect(contextFill(480_000, scale)).toEqual({ percent: 80, level: 'danger' })
  })

  it('caps the share at a full window', () => {
    expect(contextFill(900_000, scale)).toEqual({ percent: 100, level: 'danger' })
  })

  it("measures against the session's own window when the agent gave one, the setting's otherwise", () => {
    expect(contextFill(125_000, scale, 250_000)).toEqual({ percent: 50, level: 'warn' })
    expect(contextFill(125_000, scale, null).percent).toBeCloseTo(20.83, 2)
  })
})

describe('queuedAfter', () => {
  const active = { project: 'ABC', current: null, paused: false, error: null }

  it('names the running chain for the first in the queue and the one ahead for the rest', () => {
    expect(queuedAfter(chain({ active, queue: ['DEMO', 'XYZ'] }), 'DEMO')).toBe('ABC')
    expect(queuedAfter(chain({ active, queue: ['DEMO', 'XYZ'] }), 'XYZ')).toBe('DEMO')
  })

  it('is empty for a chain that is not queued', () => {
    expect(queuedAfter(chain({ active, queue: ['DEMO'] }), 'ABC')).toBeNull()
    expect(queuedAfter(chain({ active, queue: ['DEMO'] }), 'XYZ')).toBeNull()
  })

  it('names no chain for the first in the queue while several run, as any of them may end first', () => {
    const both = chain({ active: [active, { ...active, project: 'XYZ' }], parallel: 2, queue: ['DEMO', 'OPS'] })
    expect(queuedAfter(both, 'DEMO')).toBeNull()
    expect(queuedAfter(both, 'OPS')).toBe('DEMO')
  })
})

describe('sessionStart', () => {
  const now = new Date('2026-01-01T10:01:00.000Z')
  const current = (patch: Partial<CurrentTask> = {}): CurrentTask => ({ task: 'ABC-1', sessionId: 'new', since: '2026-01-01T08:00:00.000Z', ...patch })
  const run = (sessionId: string, at: string): TaskSession => ({ sessionId, at, how: 'checkpoint', resumed: 0, answers: 0 })
  const live = (patch: Partial<SessionView> = {}): SessionView => ({
    ...view('ABC-1', 'working', null),
    sessionId: 'new',
    startedAt: '2026-01-01T10:00:20.000Z',
    ...patch,
  })

  it('is a launch while the service starts the first session of the task', () => {
    const launching = current({ sessionId: null, starting: '2026-01-01T10:00:00.000Z' })
    expect(sessionStart(launching, null, [], now)).toEqual({ phase: 'launch', since: '2026-01-01T10:00:00.000Z' })
  })

  it('is a handover while the service replaces the session of the task', () => {
    const old = live({ sessionId: 'old', lamp: 'waiting', contextTokens: 170_000 })
    const handing = current({ sessionId: 'old', starting: '2026-01-01T10:00:00.000Z' })
    expect(sessionStart(handing, old, [], now)).toEqual({ phase: 'handover', since: '2026-01-01T10:00:00.000Z' })
  })

  it('is nothing while the answer goes to the same session', () => {
    const old = live({ sessionId: 'old', lamp: 'finished', contextTokens: 170_000 })
    const answering = current({ sessionId: 'old', starting: '2026-01-01T10:00:00.000Z', answering: true })
    expect(sessionStart(answering, old, [], now)).toBeNull()
  })

  it('is a boot until the page sees the new session, counted from when the start began', () => {
    const old = live({ sessionId: 'old', lamp: 'finished', contextTokens: 170_000 })
    const runs = [run('old', '2026-01-01T08:00:00.000Z'), run('new', '2026-01-01T10:00:00.000Z')]
    expect(sessionStart(current(), old, runs, now)).toEqual({ phase: 'boot', since: '2026-01-01T10:00:00.000Z' })
    expect(sessionStart(current(), null, runs, now)).toEqual({ phase: 'boot', since: '2026-01-01T10:00:00.000Z' })
  })

  it('waits for the answer while the new session works on its first one', () => {
    const runs = [run('new', '2026-01-01T10:00:00.000Z')]
    expect(sessionStart(current(), live(), runs, now)).toEqual({ phase: 'answer', since: '2026-01-01T10:00:00.000Z' })
    expect(sessionStart(current(), live(), [], now)).toEqual({ phase: 'answer', since: '2026-01-01T10:00:20.000Z' })
  })

  it('is over once the session answered, stopped or asks something', () => {
    const runs = [run('new', '2026-01-01T10:00:00.000Z')]
    expect(sessionStart(current(), live({ contextTokens: 24_000 }), runs, now)).toBeNull()
    expect(sessionStart(current(), live({ lamp: 'error' }), runs, now)).toBeNull()
    expect(sessionStart(current(), live({ lamp: 'waiting' }), runs, now)).toBeNull()
  })

  it('is nothing for a session that goes on after an answer or a resume, however fresh its process', () => {
    const answered = [{ ...run('new', '2026-01-01T10:00:00.000Z'), answers: 1 }]
    const resumed = [{ ...run('new', '2026-01-01T10:00:00.000Z'), resumed: 1 }]
    expect(sessionStart(current(), live(), answered, now)).toBeNull()
    expect(sessionStart(current(), null, answered, now)).toBeNull()
    expect(sessionStart(current(), live(), resumed, now)).toBeNull()
  })

  it('gives up on a boot that took too long to be one', () => {
    const runs = [run('new', '2026-01-01T09:50:00.000Z')]
    expect(sessionStart(current(), null, runs, now)).toBeNull()
    expect(sessionStart(current(), live({ startedAt: '2026-01-01T09:50:00.000Z' }), [], now)).toBeNull()
    expect(sessionStart(current(), null, [], now)).toBeNull()
  })
})

describe('sessionElapsed', () => {
  const now = new Date('2026-01-01T10:30:00.000Z')

  it('counts from the launch to now while the session is alive', () => {
    expect(sessionElapsed(view('ABC-1', 'working', '2026-01-01T10:29:00.000Z'), now)).toBe(90 * 60_000)
    expect(sessionElapsed(view('ABC-1', 'waiting', '2026-01-01T09:10:00.000Z'), now)).toBe(90 * 60_000)
  })

  it('stops at the last activity once the session has finished', () => {
    expect(sessionElapsed(view('ABC-1', 'finished', '2026-01-01T09:45:00.000Z'), now)).toBe(45 * 60_000)
    expect(sessionElapsed(view('ABC-1', 'finished', null), now)).toBe(0)
  })

  it('is zero when the launch is ahead of the clock', () => {
    expect(sessionElapsed(view('ABC-1', 'working', null), new Date('2026-01-01T08:59:00.000Z'))).toBe(0)
  })
})

describe('blockMetered', () => {
  it('meters a live session even when the chain is not running it', () => {
    expect(blockMetered({ current: false, session: view('ABC-1', 'working', null) })).toBe(true)
    expect(blockMetered({ current: false, session: view('ABC-1', 'waiting', null) })).toBe(true)
  })

  it('meters the current task even after its session has finished', () => {
    expect(blockMetered({ current: true, session: view('ABC-1', 'finished', null) })).toBe(true)
  })

  it('does not meter a finished session of another task or a task without one', () => {
    expect(blockMetered({ current: false, session: view('ABC-1', 'finished', null) })).toBe(false)
    expect(blockMetered({ current: true, session: null })).toBe(false)
  })
})

describe('cacheFreshness', () => {
  const now = new Date('2026-01-01T10:30:00.000Z')

  it('counts what is left of the cache lifetime', () => {
    expect(cacheFreshness({ ttl: '1h', until: '2026-01-01T11:20:00.000Z' }, now)).toEqual({ left: 50 * 60_000, level: 'ok' })
  })

  it('warns in the last fifth of the lifetime', () => {
    expect(cacheFreshness({ ttl: '1h', until: '2026-01-01T10:41:00.000Z' }, now).level).toBe('warn')
    expect(cacheFreshness({ ttl: '5m', until: '2026-01-01T10:30:50.000Z' }, now).level).toBe('warn')
    expect(cacheFreshness({ ttl: '5m', until: '2026-01-01T10:31:10.000Z' }, now).level).toBe('ok')
  })

  it('is cold once the lifetime has run out', () => {
    expect(cacheFreshness({ ttl: '5m', until: '2026-01-01T10:30:00.000Z' }, now)).toEqual({ left: 0, level: 'cold' })
    expect(cacheFreshness({ ttl: '1h', until: '2026-01-01T09:00:00.000Z' }, now)).toEqual({ left: 0, level: 'cold' })
  })
})

describe('cacheTone', () => {
  const now = new Date('2026-01-01T10:30:00.000Z')

  it('stays quiet while the cache is far from running out', () => {
    expect(cacheTone({ ttl: '1h', until: '2026-01-01T11:20:00.000Z' }, now, 'working')).toBe('ok')
    expect(cacheTone(null, now, 'working')).toBe('ok')
  })

  it('warns in the last fifth of the lifetime and alarms once the cache is cold', () => {
    expect(cacheTone({ ttl: '1h', until: '2026-01-01T10:41:00.000Z' }, now, 'waiting')).toBe('warn')
    expect(cacheTone({ ttl: '1h', until: '2026-01-01T09:00:00.000Z' }, now, 'waiting')).toBe('danger')
    expect(cacheTone({ ttl: '1h', until: '2026-01-01T09:00:00.000Z' }, now, 'limit')).toBe('danger')
  })

  it('stays quiet for a finished session: nothing will read its cache', () => {
    expect(cacheTone({ ttl: '5m', until: '2026-01-01T10:30:50.000Z' }, now, 'finished')).toBe('ok')
    expect(cacheTone({ ttl: '1h', until: '2026-01-01T09:00:00.000Z' }, now, 'finished')).toBe('ok')
  })
})

describe('tokenTotal', () => {
  it('adds input, output and both cache directions', () => {
    expect(tokenTotal({ input: 10, output: 20, cacheRead: 300, cacheWrite: 4_000 })).toBe(4_330)
  })
})

describe('issueLink', () => {
  const urls = {
    default: 'https://huly.example.com/workbench/example/tracker/{id}',
    projects: { LIN: 'https://linear.example.com/issue/{id}', GH: 'https://github.com/octo-org/abc/issues/{number}', OFF: null },
    pages: {},
  }

  it('fills the issue key into the address of the tracker its project uses', () => {
    expect(issueLink(urls, 'LIN-12')).toBe('https://linear.example.com/issue/LIN-12')
  })

  it('fills the issue number where the tracker wants the number alone', () => {
    expect(issueLink(urls, 'GH-12')).toBe('https://github.com/octo-org/abc/issues/12')
  })

  it('falls back to the shared tracker for a project the config does not name', () => {
    expect(issueLink(urls, 'ABC-12')).toBe('https://huly.example.com/workbench/example/tracker/ABC-12')
  })

  it('is empty when the tracker of the project gives no address', () => {
    expect(issueLink(urls, 'OFF-3')).toBeNull()
    expect(issueLink({ default: null, projects: {}, pages: {} }, 'ABC-12')).toBeNull()
  })

  it('is empty for a fix session of a red main, which has no task in the tracker', () => {
    expect(issueLink(urls, 'ABC-FIX')).toBeNull()
  })
})

const account = (loggedIn: boolean, email: string | null = null) => ({
  loggedIn,
  authMethod: null,
  email,
  orgName: null,
  subscriptionType: null,
})
const entry = (patch: Partial<AccountEntry>): AccountEntry => ({
  key: 'global',
  name: null,
  agent: 'claude',
  global: true,
  status: null,
  error: null,
  loginExpiresAt: null,
  needsLogin: false,
  sessions: [],
  projects: [],
  removing: false,
  configPending: false,
  apiKey: false,
  limits: null,
  usage: { state: 'ok', reason: null, since: null },
  ...patch,
})

describe('accountBadge', () => {
  const view = (patch: Partial<AccountEntry>, login: AccountLogin | null = null): AccountView => ({
    active: 'global',
    accounts: [entry(patch)],
    login,
    loginBlock: null,
    apps: [],
    pool: [],
    missing: [],
  })
  const login = { agent: 'claude', target: 'global', startedAt: '2026-09-27T10:00:00Z', urls: [], output: '', error: null, codeSent: false }

  it('shows the mailbox name of the active account', () => {
    expect(accountBadge(view({ status: account(true, 'john.doe@example.com') }))).toEqual({ kind: 'in', label: 'john.doe' })
    expect(accountBadge(view({ status: account(true) }))).toEqual({ kind: 'in', label: 'Claude' })
  })

  it('shows the name the user gave the active account', () => {
    expect(accountBadge(view({ name: 'Team API', status: account(true, 'team-api') }))).toEqual({ kind: 'in', label: 'Team API' })
  })

  it('flags a signed-out or run-out active account, a running sign-in and an unknown account', () => {
    expect(accountBadge(view({ status: account(false), needsLogin: true }))).toEqual({ kind: 'out', label: 'Нужен вход' })
    expect(accountBadge(view({ status: account(true, 'john.doe@example.com'), needsLogin: true }))).toEqual({
      kind: 'out',
      label: 'Нужен вход',
    })
    expect(accountBadge(view({ status: account(false) }, login))).toEqual({ kind: 'login', label: 'Вход…' })
    expect(accountBadge(view({ status: account(true) }, { ...login, error: textNotice('exited with code 1') }))).toEqual({
      kind: 'out',
      label: 'Вход не удался',
    })
    expect(accountBadge(view({ error: textNotice('claude: auth status timed out') }))).toEqual({ kind: 'unknown', label: 'Claude' })
    expect(accountBadge({ ...view({}), active: 'gone' })).toEqual({ kind: 'unknown', label: 'Claude' })
  })

  it('keeps the active account as it is while a new account is added, failed or not', () => {
    const adding = { ...login, agent: 'codex', target: null }
    const signedIn = { status: account(true, 'john.doe@example.com') }
    expect(accountBadge(view(signedIn, adding))).toEqual({ kind: 'in', label: 'john.doe' })
    expect(accountBadge(view(signedIn, { ...adding, error: textNotice('spawn codex ENOENT') }))).toEqual({ kind: 'in', label: 'john.doe' })
  })

  it('names any account by itself, its own sign-in only', () => {
    const work = entry({ key: 'work', global: false, status: account(true, 'jane.roe@example.com') })
    expect(entryBadge(work, null)).toEqual({ kind: 'in', label: 'jane.roe' })
    expect(entryBadge(work, login)).toEqual({ kind: 'in', label: 'jane.roe' })
    expect(entryBadge(work, { ...login, target: 'work' })).toEqual({ kind: 'login', label: 'Вход…' })
    expect(entryBadge({ ...work, needsLogin: true }, null)).toEqual({ kind: 'out', label: 'Нужен вход' })
  })
})

describe('headerAccounts', () => {
  const view = (active: string, accounts: AccountEntry[]): AccountView => ({ active, accounts, login: null, loginBlock: null, apps: [], pool: [], missing: [] })

  it('puts the active account first, then every account a project runs on', () => {
    const accounts = [
      entry({ projects: ['XYZ'] }),
      entry({ key: 'idle', global: false }),
      entry({ key: 'work', global: false, projects: ['ABC', 'DEF'] }),
      entry({ key: 'codex', agent: 'codex', projects: ['OPS'] }),
    ]
    expect(headerAccounts(view('work', accounts)).map((each) => each.key)).toEqual(['work', 'global', 'codex'])
  })

  it('keeps the active account without projects and skips a gone one', () => {
    expect(headerAccounts(view('global', [entry({}), entry({ key: 'work', global: false })])).map((each) => each.key)).toEqual(['global'])
    expect(headerAccounts(view('gone', [entry({ projects: ['ABC'] })])).map((each) => each.key)).toEqual(['global'])
  })
})

describe('loginLeft', () => {
  const now = new Date('2026-09-28T10:00:00.000Z')

  it('counts the days left of a login and asks to renew it in its last week', () => {
    expect(loginLeft('2026-10-27T10:00:00.000Z', now)).toEqual({ text: '29д', renew: false })
    expect(loginLeft('2026-10-02T09:00:00.000Z', now)).toEqual({ text: '3д', renew: true })
    expect(loginLeft('2026-09-28T20:00:00.000Z', now)).toEqual({ text: 'меньше суток', renew: true })
  })

  it('says a login ran out or is not known', () => {
    expect(loginLeft('2026-09-28T09:00:00.000Z', now)).toEqual({ text: 'истёк', renew: true })
    expect(loginLeft(null, now)).toEqual({ text: '—', renew: false })
  })
})

describe('limitedUntil', () => {
  const now = new Date('2026-10-10T10:00:00.000Z')
  const limits = (fiveHour: [number, string] | null, sevenDay: [number, string] | null) => ({
    fiveHour: fiveHour === null ? null : { usedPercentage: fiveHour[0], resetsAt: fiveHour[1] },
    sevenDay: sevenDay === null ? null : { usedPercentage: sevenDay[0], resetsAt: sevenDay[1] },
    updatedAt: '2026-10-10T09:59:00.000Z',
    source: 'usage' as const,
  })

  it('gives the reset of a used-up window', () => {
    expect(limitedUntil(entry({ limits: limits([100, '2026-10-10T12:00:00.000Z'], [40, '2026-10-14T00:00:00.000Z']) }), now)).toBe(
      '2026-10-10T12:00:00.000Z',
    )
    expect(limitedUntil(entry({ limits: limits(null, [100, '2026-10-12T00:00:00.000Z']) }), now)).toBe('2026-10-12T00:00:00.000Z')
  })

  it('takes the later reset when both windows are used up', () => {
    expect(
      limitedUntil(entry({ limits: limits([100, '2026-10-10T12:00:00.000Z'], [100, '2026-10-12T00:00:00.000Z']) }), now),
    ).toBe('2026-10-12T00:00:00.000Z')
  })

  it('ignores windows with room left, already reset or unknown', () => {
    expect(limitedUntil(entry({ limits: limits([99, '2026-10-10T12:00:00.000Z'], [64, '2026-10-14T00:00:00.000Z']) }), now)).toBeNull()
    expect(limitedUntil(entry({ limits: limits([100, '2026-10-10T09:00:00.000Z'], null) }), now)).toBeNull()
    expect(limitedUntil(entry({ limits: null }), now)).toBeNull()
  })

  it('counts a used-up month', () => {
    const monthly = { ...limits(null, null), month: { usedPercentage: 100, resetsAt: '2026-10-28T21:15:48.000Z' } }
    expect(limitedUntil(entry({ limits: monthly }), now)).toBe('2026-10-28T21:15:48.000Z')
  })
})

describe('accountOrder', () => {
  const now = new Date('2026-10-10T10:00:00.000Z')
  const ready = (key: string) => entry({ key, global: false, status: account(true) })
  const spent = (key: string) => ({
    ...ready(key),
    limits: {
      fiveHour: null,
      sevenDay: { usedPercentage: 100, resetsAt: '2026-10-12T00:00:00.000Z' },
      updatedAt: '2026-10-10T09:59:00.000Z',
      source: 'usage' as const,
    },
  })
  const keys = (entries: AccountEntry[]) => accountOrder(entries, now).map((each) => each.key)

  it('puts the accounts that can work now first and keeps the order inside each group', () => {
    expect(keys([spent('a'), ready('b'), spent('c'), ready('d')])).toEqual(['b', 'd', 'a', 'c'])
  })

  it('counts a signed-out or leaving account as unable to work', () => {
    expect(keys([{ ...ready('a'), needsLogin: true }, ready('b'), { ...ready('c'), removing: true }, entry({ key: 'd', status: null })])).toEqual(
      ['b', 'a', 'c', 'd'],
    )
  })
})

describe('usageNotice', () => {
  const since = '2026-09-27T17:00:00.000Z'

  it('stays quiet while /usage is read or not asked yet', () => {
    expect(usageNotice({ state: 'ok', reason: null, since })).toBeNull()
    expect(usageNotice({ state: 'waiting', reason: null, since: null })).toBeNull()
  })

  it('warns that limits fall back to statusline when /usage is unreadable', () => {
    const banner = usageNotice({ state: 'unread', reason: notice('usage.noSession', {}), since })

    expect(banner).toMatchObject({ tone: 'warn', key: `unread:${since}` })
    expect(banner?.text).toMatch(/statusline/)
    expect(banner?.text).toMatch(/нет читаемой строки «Current session»/)
  })

  it('alarms when /usage polling was turned off', () => {
    const banner = usageNotice({ state: 'off', reason: notice('usage.turns', { value: '1' }), since })

    expect(banner).toMatchObject({ tone: 'error', key: `off:${since}` })
    expect(banner?.text).toMatch(/выключен/)
    expect(banner?.text).toMatch(/num_turns = 1, а не 0/)
  })
})
