import { describe, expect, it } from 'vitest'
import { notice, textNotice, type Notice } from '../../src/notice/notice.js'
import { fakeTask } from '../../src/tracker/fixture.js'
import { setLanguage } from './i18n/index.js'
import type { StatusCategory, Task } from '../../src/tracker/model.js'
import type { AccountEntry, AccountLogin, AccountView } from '../../src/account/model.js'
import type { EvenKeelState, SessionView } from '../../src/state.js'
import type { ActiveChain } from '../../src/chain/dispatcher.js'
import {
  accountBadge,
  backlogTasks,
  loginLeft,
  cardTask,
  openQuestions,
  chainBlocks,
  chainProgress,
  chainStatus,
  contextFill,
  issueLink,
  projectSlot,
  queuedAfter,
  sessionElapsed,
  startsNow,
  cacheFreshness,
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
    cwd: 'C:\\repos\\example',
    lamp,
    waitingFor: null,
    apiError: null,
    startedAt: '2026-01-01T09:00:00.000Z',
    lastActivityAt,
    contextTokens: 0,
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

function task(id: string, category: StatusCategory = 'Active', blockedBy: string[] = []): Task {
  return fakeTask(id, { status: { name: category, category }, blockedBy })
}

function stateOf(patch: Partial<EvenKeelState>): EvenKeelState {
  return {
    startedAt: '2026-01-01T08:00:00.000Z',
    projects: ['ABC', 'XYZ'],
    chain: { active: [], parallel: 1, queue: [], projects: {}, skipped: {}, leftovers: {} },
    tasks: [],
    sessions: [],
    limits: null,
    usage: { state: 'ok', reason: null, since: null },
    account: { active: 'global', accounts: [], login: null, loginBlock: null, apps: [] },
    trackers: [{ name: 'huly', title: 'Huly', projects: ['ABC', 'XYZ'], health: { state: 'live', lastOkAt: null, error: null } }],
    trackerUrls: { default: null, projects: {} },
    launches: [],
    taskSessions: {},
    context: { window: 600_000, warn: 50, danger: 80 },
    configError: null,
    mcpMissing: [],
    language: null,
    unattended: false,
    trimTools: true,
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
})

describe('taskProject', () => {
  it('takes the project key off a task id', () => {
    expect(taskProject('ABC-12')).toBe('ABC')
    expect(taskProject('MY_KEY2-3')).toBe('MY_KEY2')
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
    expect(cardTask(state, 'ABC')).toEqual({ id: 'ABC-3', title: 'ABC-3', lamp: 'idle', next: true })
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

  it('takes the lamp of a finished session when there is no other', () => {
    const state = stateOf({
      tasks: [task('ABC-3')],
      sessions: [view('ABC-3', 'finished', null)],
      chain: chain({ projects: orders }),
    })
    expect(cardTask(state, 'ABC')?.lamp).toBe('finished')
  })

  it('has no task when the chain is empty or not built yet', () => {
    expect(cardTask(stateOf({ chain: chain({ projects: { ABC: { order: [], waiting: [], backlog: [], error:null } } }) }), 'ABC')).toBeNull()
    expect(cardTask(stateOf({}), 'ABC')).toBeNull()
  })

  it('keeps a task Huly has not delivered yet, without a title', () => {
    const state = stateOf({ chain: chain({ projects: orders }) })
    expect(cardTask(state, 'ABC')).toEqual({ id: 'ABC-3', title: null, lamp: 'idle', next: true })
  })
})

describe('projectSlot', () => {
  it('numbers projects from one in config order and gives none past the eighth', () => {
    const projects = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']
    expect(projectSlot(projects, 'A')).toBe(1)
    expect(projectSlot(projects, 'H')).toBe(8)
    expect(projectSlot(projects, 'I')).toBeNull()
    expect(projectSlot(projects, 'Z')).toBeNull()
  })
})

describe('chainBlocks', () => {
  const running = (current: string, paused = false) => ({
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

  it('carries the sessions of each task and the pending limit of the current one', () => {
    const hold = {
      at: '2026-01-01T10:00:00.000Z',
      account: 'john@example.com',
      resetsAt: '2026-01-01T13:00:00.000Z',
      lastReplyAt: '2026-01-01T09:59:00.000Z',
      then: 'relay' as const,
      acted: null,
    }
    const rows = [{ sessionId: 's2', at: '2026-01-01T13:00:00.000Z', how: 'relay' as const, resumed: 0 }]
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
    const launch = (at: string) => ({ sessionId: `s-${at}`, at, how: 'launch' as const, resumed: 0 })
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
    const planned = (id: string, category: StatusCategory, label: string, blockedBy: string[] = []): Task => ({
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

  it('carries the title and status name, and keeps a task Huly has not delivered yet', () => {
    const state = stateOf({
      tasks: [fakeTask('ABC-1', { title: 'First', status: { name: 'In Progress', category: 'Active' } })],
      chain: chain({ projects: { ABC: { order: ['ABC-1', 'ABC-2'], waiting: [], backlog: [], error:null } } }),
    })
    expect(chainBlocks(state, 'ABC').map(({ id, title, status }) => ({ id, title, status }))).toEqual([
      { id: 'ABC-1', title: 'First', status: 'In Progress' },
      { id: 'ABC-2', title: null, status: null },
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

describe('tokenTotal', () => {
  it('adds input, output and both cache directions', () => {
    expect(tokenTotal({ input: 10, output: 20, cacheRead: 300, cacheWrite: 4_000 })).toBe(4_330)
  })
})

describe('issueLink', () => {
  const urls = {
    default: 'https://huly.example.com/workbench/example/tracker/{id}',
    projects: { LIN: 'https://linear.example.com/issue/{id}', GH: 'https://github.com/octo-org/abc/issues/{number}', OFF: null },
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
    expect(issueLink({ default: null, projects: {} }, 'ABC-12')).toBeNull()
  })
})

describe('accountBadge', () => {
  const account = (loggedIn: boolean, email: string | null = null) => ({
    loggedIn,
    authMethod: null,
    email,
    orgName: null,
    subscriptionType: null,
  })
  const entry = (patch: Partial<AccountEntry>): AccountEntry => ({
    key: 'global',
    global: true,
    status: null,
    error: null,
    loginExpiresAt: null,
    needsLogin: false,
    sessions: [],
    removing: false,
    configPending: false,
    limits: null,
    usage: { state: 'ok', reason: null, since: null },
    ...patch,
  })
  const view = (patch: Partial<AccountEntry>, login: AccountLogin | null = null): AccountView => ({
    active: 'global',
    accounts: [entry(patch)],
    login,
    loginBlock: null,
    apps: [],
  })
  const login = { target: 'global', startedAt: '2026-09-27T10:00:00Z', urls: [], output: '', error: null, codeSent: false }

  it('shows the mailbox name of the active account', () => {
    expect(accountBadge(view({ status: account(true, 'john.doe@example.com') }))).toEqual({ kind: 'in', label: 'john.doe' })
    expect(accountBadge(view({ status: account(true) }))).toEqual({ kind: 'in', label: 'Claude' })
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
})

describe('loginLeft', () => {
  const now = new Date('2026-09-28T10:00:00.000Z')

  it('counts the days left of a login and asks to renew it in its last week', () => {
    expect(loginLeft('2026-10-27T10:00:00.000Z', now)).toEqual({ text: '29 дн.', renew: false })
    expect(loginLeft('2026-10-02T09:00:00.000Z', now)).toEqual({ text: '3 дн.', renew: true })
    expect(loginLeft('2026-09-28T20:00:00.000Z', now)).toEqual({ text: 'меньше суток', renew: true })
  })

  it('says a login ran out or is not known', () => {
    expect(loginLeft('2026-09-28T09:00:00.000Z', now)).toEqual({ text: 'истёк', renew: true })
    expect(loginLeft(null, now)).toEqual({ text: '—', renew: false })
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
