import { describe, expect, it } from 'vitest'
import { notice, textNotice, type Notice } from '../../src/notice/notice.js'
import { fakeTask } from '../../src/tracker/fixture.js'
import { setLanguage } from './i18n/index.js'
import { FAKE_SHARED } from './live/fakeConfig.js'
import type { StatusCategory, Task } from '../../src/tracker/model.js'
import type { AccountEntry, AccountLogin, AccountView } from '../../src/account/model.js'
import type { EvenKeelState, SessionView } from '../../src/state.js'
import type { ActiveChain, CurrentTask, ProjectOrder } from '../../src/chain/dispatcher.js'
import type { TaskSession } from '../../src/chain/launches.js'
import {
  accountBadge,
  accountOrder,
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
  issueLink,
  projectSlot,
  projectOfPath,
  projectPath,
  questionPath,
  queuedAfter,
  sessionElapsed,
  sessionStart,
  startsNow,
  cacheFreshness,
  cacheTone,
  taskLinks,
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
    checkpoint: false,
    waitingFor: null,
    startupDialog: null,
    asking: false,
    ask: null,
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
    projectIds: { ABC: 'id-abc', XYZ: 'id-xyz' },
    config: { shared: FAKE_SHARED, projects: {}, restart: [], trackers: [], trackerLocked: [] },
    chain: { active: [], parallel: 1, queue: [], projects: {}, skipped: {}, leftovers: {} },
    tasks: [],
    sessions: [],
    limits: null,
    usage: { state: 'ok', reason: null, since: null },
    account: { active: 'global', accounts: [], login: null, loginBlock: null, apps: [] },
    trackers: [{ name: 'huly', title: 'Huly', projects: ['ABC', 'XYZ'], ready: true, health: { state: 'live', lastOkAt: null, error: null } }],
    trackerUrls: { default: null, projects: {} },
    ci: {},
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
  it('takes the project key off a task id', () => {
    expect(taskProject('ABC-12')).toBe('ABC')
    expect(taskProject('MY_KEY2-3')).toBe('MY_KEY2')
  })

  it('takes the project key off the name of a fix session', () => {
    expect(taskProject('ABC-FIX')).toBe('ABC')
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
  it('name a project by its id, a project without one by its key', () => {
    const state = stateOf({ projectIds: { ABC: 'id-abc' } })
    expect(projectPath(state, 'ABC')).toBe('/p/id-abc')
    expect(projectPath(state, 'XYZ')).toBe('/p/XYZ')
  })

  it('read the project from its id and from the key of an older link', () => {
    const state = stateOf({})
    expect(projectOfPath(state, 'id-xyz')).toEqual({ project: 'XYZ', byKey: false })
    expect(projectOfPath(state, 'ABC')).toEqual({ project: 'ABC', byKey: true })
    expect(projectOfPath(state, 'nothing')).toEqual({ project: 'nothing', byKey: false })
  })
})

describe('questionPath', () => {
  const question = (id: string, category: StatusCategory = 'ToDo'): Task => ({ ...task(id, category), question: true })
  const order = (ids: string[], waiting: string[] = []) => ({ order: ids, waiting, backlog: [], error: null })

  it('leads to the session of the only open question', () => {
    const state = stateOf({
      tasks: [task('ABC-1'), question('ABC-2')],
      sessions: [view('ABC-2', 'waiting', null)],
      chain: chain({ projects: { ABC: order(['ABC-1', 'ABC-2']) } }),
    })
    expect(questionPath(state, ['ABC', 'XYZ'])).toBe('/p/id-abc#ABC-2')
  })

  it('takes the first question in chain order, across projects in page order', () => {
    const state = stateOf({
      tasks: [question('ABC-2'), question('ABC-3'), question('XYZ-1')],
      sessions: [view('ABC-2', 'waiting', null), view('ABC-3', 'working', null), view('XYZ-1', 'waiting', null)],
      chain: chain({ projects: { ABC: order(['ABC-3', 'ABC-2']), XYZ: order(['XYZ-1']) } }),
    })
    expect(questionPath(state, ['ABC', 'XYZ'])).toBe('/p/id-abc#ABC-3')
    expect(questionPath(state, ['XYZ', 'ABC'])).toBe('/p/id-xyz#XYZ-1')
    expect(questionPath(state, ['XYZ'])).toBe('/p/id-xyz#XYZ-1')
  })

  it('leads to the project page while no question has a session: ahead in the chain, held back or in the backlog', () => {
    const state = stateOf({
      tasks: [question('ABC-1'), question('ABC-2'), question('ABC-3', 'UnStarted')],
      sessions: [view('ABC-2', 'finished', null)],
      chain: chain({ projects: { ABC: { ...order(['ABC-1'], ['ABC-2']), backlog: ['ABC-3'] } } }),
    })
    expect(questionPath(state, ['ABC'])).toBe('/p/id-abc')
  })

  it('passes a question without a session for a later one that has it', () => {
    const state = stateOf({
      tasks: [question('ABC-1'), question('XYZ-1'), question('XYZ-2')],
      sessions: [view('XYZ-2', 'waiting', null)],
      chain: chain({ projects: { ABC: order(['ABC-1']), XYZ: order(['XYZ-1', 'XYZ-2']) } }),
    })
    expect(questionPath(state, ['ABC', 'XYZ'])).toBe('/p/id-xyz#XYZ-2')
  })

  it('counts a question whose session is only starting', () => {
    const state = stateOf({
      tasks: [question('ABC-1')],
      chain: chain({
        active: { project: 'ABC', current: { task: 'ABC-1', sessionId: null, since: '2026-01-01T08:00:00.000Z' }, paused: false, error: null },
        projects: { ABC: order(['ABC-1']) },
      }),
    })
    expect(questionPath(state, ['ABC'])).toBe('/p/id-abc#ABC-1')
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
  const tracker = (ready: boolean) => ({ name: 'huly', title: 'Huly', projects: ['ABC'], ready, health: { state: 'live' as const, lastOkAt: null, error: null } })

  it('is true when the tracker of the project can move a task to Todo', () => {
    expect(canReady(stateOf({ trackers: [tracker(true)] }), 'ABC')).toBe(true)
  })

  it('is false when the tracker cannot or the project has no tracker', () => {
    expect(canReady(stateOf({ trackers: [tracker(false)] }), 'ABC')).toBe(false)
    expect(canReady(stateOf({ trackers: [tracker(true)] }), 'XYZ')).toBe(false)
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

  describe('the fix session of a red main', () => {
    const order = { ABC: { order: ['ABC-2', 'ABC-3'], waiting: [], backlog: [], error: null } }
    const tasks = [task('ABC-1', 'Won'), task('ABC-2', 'Active'), task('ABC-3', 'ToDo')]
    const stopped = { task: 'ABC-2', sessionId: 's2', since: 't', at: '2026-01-01T10:00:00.000Z', commit: 'a1b2c3d' }

    it('leads the open tasks as a block of its own, with its session and launches', () => {
      const rows = [{ sessionId: 's', at: '2026-01-01T10:01:00.000Z', how: 'launch' as const, resumed: 0 }]
      const session = view('ABC-FIX', 'working', null)
      const state = stateOf({
        tasks,
        sessions: [session],
        chain: chain({ active: { ...running('ABC-FIX'), interrupted: stopped }, projects: order }),
        taskSessions: { 'ABC-FIX': rows },
      })
      const blocks = chainBlocks(state, 'ABC')
      expect(blocks.map((block) => [block.id, block.current])).toEqual([
        ['ABC-1', false],
        ['ABC-FIX', true],
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
        ['ABC-FIX', undefined],
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
        ['ABC-FIX', false],
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
      expect(chainBlocks(state, 'ABC').map((block) => block.id)).toEqual(['ABC-1', 'ABC-FIX'])
    })

    it('is absent while main is green', () => {
      const state = stateOf({ tasks, chain: chain({ active: running('ABC-2'), projects: order }) })
      expect(chainBlocks(state, 'ABC').map((block) => block.id)).toEqual(['ABC-1', 'ABC-2', 'ABC-3'])
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
      tasks: [fakeTask('ABC-1', { title: 'First', status: { name: 'In Progress', category: 'Active' } })],
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
  const run = (sessionId: string, at: string): TaskSession => ({ sessionId, at, how: 'checkpoint', resumed: 0 })
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

describe('accountBadge', () => {
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
