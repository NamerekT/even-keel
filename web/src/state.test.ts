import { describe, expect, it } from 'vitest'
import type { HulyTask, StatusCategory } from '../../src/huly/model.js'
import type { AccountView } from '../../src/account/model.js'
import type { BatonState, SessionView } from '../../src/state.js'
import {
  accountBadge,
  cardTask,
  chainBlocks,
  chainProgress,
  chainStatus,
  contextFill,
  issueLink,
  projectSlot,
  queuedAfter,
  sessionElapsed,
  taskProject,
  tokenTotal,
  usageNotice,
  waitingSessions,
} from './state.js'

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
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    stage: null,
    action: null,
    feed: [],
    remoteUrl: null,
    remoteOff: null,
  }
}

function task(id: string, category: StatusCategory = 'Active', blockedBy: string[] = []): HulyTask {
  return { id, title: id, status: { name: category, category }, blockedBy, milestone: null }
}

function baton(patch: Partial<BatonState>): BatonState {
  return {
    startedAt: '2026-01-01T08:00:00.000Z',
    projects: ['ABC', 'XYZ'],
    chain: { active: null, queue: [], projects: {}, skipped: {} },
    tasks: [],
    sessions: [],
    limits: null,
    usage: { state: 'ok', reason: null, since: null },
    account: { status: null, error: null, login: null, loginBlock: null },
    huly: { state: 'live', lastOkAt: null, error: null },
    trackerUrl: null,
    launches: [],
    taskSessions: {},
    context: { window: 600_000, warn: 50, danger: 80 },
    ...patch,
  }
}

const chain = (patch: Partial<BatonState['chain']>): BatonState['chain'] => ({
  active: null,
  queue: [],
  projects: {},
  skipped: {},
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

describe('chainProgress', () => {
  it('counts done tasks against all but the canceled ones', () => {
    const tasks = [task('ABC-1', 'Won'), task('ABC-2', 'Won'), task('ABC-3', 'Lost'), task('ABC-4'), task('ABC-5', 'ToDo')]
    expect(chainProgress(tasks)).toEqual({ done: 2, total: 4 })
  })

  it('is zero of zero with no tasks', () => {
    expect(chainProgress([])).toEqual({ done: 0, total: 0 })
  })
})

describe('chainStatus', () => {
  const active = (patch: { paused?: boolean; error?: string | null; limitUntil?: string } = {}) => ({
    project: 'ABC',
    current: null,
    paused: patch.paused ?? false,
    error: patch.error ?? null,
    ...(patch.limitUntil === undefined ? {} : { limitUntil: patch.limitUntil }),
  })

  it('tells a running chain from a paused one', () => {
    expect(chainStatus(chain({ active: active() }), 'ABC')).toEqual({ kind: 'running', limitUntil: null })
    expect(chainStatus(chain({ active: active({ paused: true }) }), 'ABC')).toEqual({ kind: 'paused', error: null })
    expect(chainStatus(chain({ active: active({ paused: true, error: 'boom' }) }), 'ABC')).toEqual({
      kind: 'paused',
      error: 'boom',
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
})

describe('cardTask', () => {
  const orders = { ABC: { order: ['ABC-3', 'ABC-4'], error: null } }

  it('shows the current task of the active chain with the lamp of its session', () => {
    const state = baton({
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
    const state = baton({ tasks: [task('ABC-3'), task('ABC-4')], chain: chain({ projects: orders }) })
    expect(cardTask(state, 'ABC')).toEqual({ id: 'ABC-3', title: 'ABC-3', lamp: 'idle', next: true })
  })

  it('passes over a skipped task when naming the next one', () => {
    const state = baton({ tasks: [task('ABC-3'), task('ABC-4')], chain: chain({ projects: orders, skipped: { ABC: ['ABC-3'] } }) })
    expect(cardTask(state, 'ABC')?.id).toBe('ABC-4')
  })

  it('takes the lamp of a finished session when there is no other', () => {
    const state = baton({
      tasks: [task('ABC-3')],
      sessions: [view('ABC-3', 'finished', null)],
      chain: chain({ projects: orders }),
    })
    expect(cardTask(state, 'ABC')?.lamp).toBe('finished')
  })

  it('has no task when the chain is empty or not built yet', () => {
    expect(cardTask(baton({ chain: chain({ projects: { ABC: { order: [], error: null } } }) }), 'ABC')).toBeNull()
    expect(cardTask(baton({}), 'ABC')).toBeNull()
  })

  it('keeps a task Huly has not delivered yet, without a title', () => {
    const state = baton({ chain: chain({ projects: orders }) })
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
    const state = baton({
      tasks: [task('ABC-1', 'ToDo'), task('ABC-2', 'ToDo')],
      chain: chain({ projects: { ABC: { order: ['ABC-1', 'ABC-2'], error: null } }, skipped: { ABC: ['ABC-2'] } }),
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
    const state = baton({
      tasks: [task('ABC-1', 'Active'), task('ABC-2', 'ToDo')],
      chain: chain({
        active: { ...running('ABC-1'), current: { task: 'ABC-1', sessionId: 's', since: 't', limit: hold } },
        projects: { ABC: { order: ['ABC-1', 'ABC-2'], error: null } },
      }),
      taskSessions: { 'ABC-1': rows },
    })
    const [first, second] = chainBlocks(state, 'ABC')
    expect(first).toMatchObject({ sessions: rows, limit: hold })
    expect(second).toMatchObject({ sessions: [], limit: null })

    const acted = baton({ ...state, chain: chain({ ...state.chain, active: { ...running('ABC-1'), current: { task: 'ABC-1', sessionId: 's', since: 't', limit: { ...hold, acted: 'relay' } } } }) })
    expect(chainBlocks(acted, 'ABC')[0]?.limit).toBeNull()
  })

  it('puts closed tasks first in blocking order, then the open ones in chain order', () => {
    const state = baton({
      tasks: [
        task('ABC-1', 'Won', ['ABC-2']),
        task('ABC-2', 'Won'),
        task('ABC-3', 'Lost'),
        task('ABC-4', 'ToDo'),
        task('ABC-5', 'ToDo'),
        task('XYZ-1', 'Won'),
      ],
      chain: chain({ projects: { ABC: { order: ['ABC-5', 'ABC-4'], error: null } } }),
    })
    expect(chainBlocks(state, 'ABC').map((block) => block.id)).toEqual(['ABC-2', 'ABC-1', 'ABC-3', 'ABC-5', 'ABC-4'])
  })

  it('marks which tasks are open and carries their blockers', () => {
    const state = baton({
      tasks: [task('ABC-1', 'Won'), task('ABC-2', 'ToDo', ['ABC-1']), task('ABC-3', 'ToDo', ['ABC-2', 'XYZ-4'])],
      chain: chain({ projects: { ABC: { order: ['ABC-2', 'ABC-3'], error: null } } }),
    })
    expect(chainBlocks(state, 'ABC').map(({ id, open, blockedBy }) => ({ id, open, blockedBy }))).toEqual([
      { id: 'ABC-1', open: false, blockedBy: [] },
      { id: 'ABC-2', open: true, blockedBy: ['ABC-1'] },
      { id: 'ABC-3', open: true, blockedBy: ['ABC-2', 'XYZ-4'] },
    ])
  })

  it('carries the milestone label and what an open task must follow, blockers and earlier milestones alike', () => {
    const planned = (id: string, category: StatusCategory, label: string, blockedBy: string[] = []): HulyTask => ({
      ...task(id, category, blockedBy),
      milestone: { label, targetDate: 0 },
    })
    const state = baton({
      tasks: [planned('ABC-1', 'Won', 'v0.1'), planned('ABC-2', 'ToDo', 'v0.1'), planned('ABC-3', 'ToDo', 'v0.2', ['ABC-4']), task('ABC-4', 'ToDo')],
      chain: chain({ projects: { ABC: { order: ['ABC-2', 'ABC-4', 'ABC-3'], error: null } } }),
    })
    expect(chainBlocks(state, 'ABC').map(({ id, milestone, after }) => ({ id, milestone, after }))).toEqual([
      { id: 'ABC-1', milestone: 'v0.1', after: [] },
      { id: 'ABC-2', milestone: 'v0.1', after: [] },
      { id: 'ABC-4', milestone: null, after: [] },
      { id: 'ABC-3', milestone: 'v0.2', after: ['ABC-4', 'ABC-2'] },
    ])
  })

  it('lights done green, canceled as canceled and open tasks without a session grey', () => {
    const state = baton({
      tasks: [task('ABC-1', 'Won'), task('ABC-2', 'Lost'), task('ABC-3', 'ToDo')],
      sessions: [view('ABC-1', 'finished', null)],
      chain: chain({ projects: { ABC: { order: ['ABC-3'], error: null } } }),
    })
    expect(chainBlocks(state, 'ABC').map((block) => block.lamp)).toEqual(['done', 'canceled', 'ahead'])
  })

  it('takes the lamp of an open task from its session, a finished one showing as stopped', () => {
    const ids = ['ABC-1', 'ABC-2', 'ABC-3', 'ABC-4', 'ABC-5']
    const state = baton({
      tasks: ids.map((id) => task(id)),
      sessions: [
        view('ABC-1', 'working', null),
        view('ABC-2', 'waiting', null),
        view('ABC-3', 'error', null),
        view('ABC-4', 'limit', null),
        view('ABC-5', 'finished', null),
      ],
      chain: chain({ projects: { ABC: { order: ids, error: null } } }),
    })
    expect(chainBlocks(state, 'ABC').map((block) => block.lamp)).toEqual(['working', 'waiting', 'error', 'limit', 'stopped'])
  })

  it('prefers a live session over a finished one of the same task', () => {
    const state = baton({
      tasks: [task('ABC-1')],
      sessions: [view('ABC-1', 'finished', null), view('ABC-1', 'waiting', null)],
      chain: chain({ projects: { ABC: { order: ['ABC-1'], error: null } } }),
    })
    const [block] = chainBlocks(state, 'ABC')
    expect(block?.lamp).toBe('waiting')
    expect(block?.session?.lamp).toBe('waiting')
  })

  it('marks the current task of the active chain, paused or not, and only in its own project', () => {
    const tasks = [task('ABC-1'), task('ABC-2')]
    const projects = { ABC: { order: ['ABC-1', 'ABC-2'], error: null } }
    const current = (active: BatonState['chain']['active']) =>
      chainBlocks(baton({ tasks, chain: chain({ active, projects }) }), 'ABC').map((block) => block.current)
    expect(current(running('ABC-1'))).toEqual([true, false])
    expect(current(running('ABC-1', true))).toEqual([true, false])
    expect(current({ ...running('ABC-1'), project: 'XYZ' })).toEqual([false, false])
    expect(current(null)).toEqual([false, false])
  })

  it('carries the title and status name, and keeps a task Huly has not delivered yet', () => {
    const state = baton({
      tasks: [{ id: 'ABC-1', title: 'First', status: { name: 'In Progress', category: 'Active' }, blockedBy: [], milestone: null }],
      chain: chain({ projects: { ABC: { order: ['ABC-1', 'ABC-2'], error: null } } }),
    })
    expect(chainBlocks(state, 'ABC').map(({ id, title, status }) => ({ id, title, status }))).toEqual([
      { id: 'ABC-1', title: 'First', status: 'In Progress' },
      { id: 'ABC-2', title: null, status: null },
    ])
  })

  it('falls back to open tasks by number when the chain order is broken', () => {
    const state = baton({
      tasks: [task('ABC-10'), task('ABC-9'), task('ABC-1', 'Won')],
      chain: chain({ projects: { ABC: { order: [], error: 'chain: cycle: ABC-9 → ABC-10 → ABC-9' } } }),
    })
    expect(chainBlocks(state, 'ABC').map((block) => block.id)).toEqual(['ABC-1', 'ABC-9', 'ABC-10'])
  })

  it('orders closed tasks by number when their links form a cycle', () => {
    const state = baton({ tasks: [task('ABC-2', 'Won', ['ABC-1']), task('ABC-1', 'Won', ['ABC-2'])] })
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

describe('tokenTotal', () => {
  it('adds input, output and both cache directions', () => {
    expect(tokenTotal({ input: 10, output: 20, cacheRead: 300, cacheWrite: 4_000 })).toBe(4_330)
  })
})

describe('issueLink', () => {
  it('appends the issue key to the tracker address', () => {
    expect(issueLink('https://huly.example.com/workbench/example/tracker/', 'ABC-12')).toBe(
      'https://huly.example.com/workbench/example/tracker/ABC-12',
    )
  })

  it('is empty when Huly is not configured', () => {
    expect(issueLink(null, 'ABC-12')).toBeNull()
  })
})

describe('accountBadge', () => {
  const view = (patch: Partial<AccountView>): AccountView => ({ status: null, error: null, login: null, loginBlock: null, ...patch })
  const account = (loggedIn: boolean, email: string | null = null) => ({
    loggedIn,
    authMethod: null,
    email,
    orgName: null,
    subscriptionType: null,
  })
  const login = { startedAt: '2026-09-27T10:00:00Z', urls: [], output: '', error: null, codeSent: false }

  it('shows the mailbox name of a signed-in account', () => {
    expect(accountBadge(view({ status: account(true, 'john.doe@example.com') }))).toEqual({ kind: 'in', label: 'john.doe' })
    expect(accountBadge(view({ status: account(true) }))).toEqual({ kind: 'in', label: 'Claude' })
  })

  it('flags a signed-out dispatcher, a running sign-in and an unknown account', () => {
    expect(accountBadge(view({ status: account(false) }))).toEqual({ kind: 'out', label: 'Не вошли' })
    expect(accountBadge(view({ status: account(false), login }))).toEqual({ kind: 'login', label: 'Вход…' })
    expect(accountBadge(view({ status: account(true), login: { ...login, error: 'exited with code 1' } }))).toEqual({
      kind: 'out',
      label: 'Вход не удался',
    })
    expect(accountBadge(view({ error: 'claude: auth status timed out' }))).toEqual({ kind: 'unknown', label: 'Claude' })
  })
})

describe('usageNotice', () => {
  const since = '2026-09-27T17:00:00.000Z'

  it('stays quiet while /usage is read or not asked yet', () => {
    expect(usageNotice({ state: 'ok', reason: null, since })).toBeNull()
    expect(usageNotice({ state: 'waiting', reason: null, since: null })).toBeNull()
  })

  it('warns that limits fall back to statusline when /usage is unreadable', () => {
    const notice = usageNotice({ state: 'unread', reason: 'no readable "Current session" line', since })

    expect(notice).toMatchObject({ tone: 'warn', key: `unread:${since}` })
    expect(notice?.text).toMatch(/statusline/)
    expect(notice?.text).toMatch(/no readable "Current session" line/)
  })

  it('alarms when /usage polling was turned off', () => {
    const notice = usageNotice({ state: 'off', reason: 'num_turns is 1, not 0', since })

    expect(notice).toMatchObject({ tone: 'error', key: `off:${since}` })
    expect(notice?.text).toMatch(/выключен/)
    expect(notice?.text).toMatch(/num_turns is 1, not 0/)
  })
})
