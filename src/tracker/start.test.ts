import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_RULES } from '../chain/rules.js'
import * as merged from '../git/merged.js'
import type { TrackerView } from './health.js'
import { toTask, type TrackerTask } from './model.js'
import { TrackerNotFound, type TaskSource, type TrackerSetup } from './source.js'
import { startTracker, type TrackerHandle, type TrackerStartDeps } from './start.js'

const task = (id: string): TrackerTask => ({
  id,
  title: id,
  status: { name: 'Todo', category: 'ToDo' },
  blockedBy: [],
  parent: null,
  subtasks: 0,
  milestone: null,
  priority: 'none',
  labels: [],
  estimate: null,
})

/**
 * A Huly-like connection: `missing` projects are not in the tracker, and a call still under way when the connection
 * closes fails with "Connection closed", as the Huly client's do. A read of a present project waits until the read of
 * a missing one has failed, so it is under way at that moment.
 */
function hulyLike(missing: Set<string>) {
  let closed = false
  let failed!: () => void
  const missingFailed = new Promise<void>((resolve) => (failed = resolve))
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10))
  const source: TaskSource = {
    async chainTasks(project) {
      if (missing.has(project)) {
        failed()
        throw new TrackerNotFound(`huly: project ${project} not found`)
      }
      if (missing.size > 0) await missingFailed
      await settle()
      if (closed) throw new Error('Connection closed')
      return { tasks: [task(`${project}-1`)], statuses: ['Todo'] }
    },
    tasks: async () => [],
    close: async () => {
      closed = true
    },
  }
  return source
}

const handles: TrackerHandle[] = []
afterEach(() => {
  for (const handle of handles.splice(0)) handle.stop()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function start(projects: string[], connect: () => Promise<TaskSource>, overrides: Partial<TrackerStartDeps> = {}) {
  const view: TrackerView = { name: 'huly', kind: 'huly', title: 'Huly', projects, ready: false, health: { state: 'connecting', lastOkAt: null, error: null }, readAt: {} }
  const setup: TrackerSetup = { connect, issueUrl: () => null } as unknown as TrackerSetup
  const dispatcher = { setTasks: vi.fn(), setOutside: vi.fn(), released: () => [], setReleased: vi.fn(), held: () => [], preview: vi.fn() }
  const refreshers = new Map<string, () => Promise<void>>()
  const deps: TrackerStartDeps = {
    repoOf: () => '/repo',
    rulesOf: () => DEFAULT_RULES,
    links: new Map(),
    tasksByProject: new Map(),
    ranSince: () => [],
    dispatcher: dispatcher as unknown as TrackerStartDeps['dispatcher'],
    fillsMilestone: () => false,
    mainBranch: () => 'main',
    readKey: (project) => project,
    broadcast: () => {},
    refreshers,
    ...overrides,
  }
  handles.push(startTracker(view, setup, deps))
  return { view, dispatcher, refreshers, deps }
}

describe('startTracker', () => {
  it('rechecks on every read whether anyone may open a task the chain takes (BTN-1134)', async () => {
    let open = true
    let rules = DEFAULT_RULES
    const { view, refreshers } = start(['APP', 'OWN'], async () => ({
      chainTasks: async () => ({ tasks: [], statuses: [] }), tasks: async () => [], close: async () => {},
      isPublic: async (project: string) => open && project === 'APP',
    }), { rulesOf: () => rules })
    await vi.waitFor(() => expect(view.openToAll).toEqual({ APP: true, OWN: false }))
    rules = { ...DEFAULT_RULES, requiredLabels: ['ready'] }
    await refreshers.get('APP')!()
    expect(view.openToAll?.APP).toBe(false)
    rules = DEFAULT_RULES
    open = false
    await refreshers.get('APP')!()
    expect(view.openToAll?.APP).toBe(false)
  })

  it('keeps the last answer on visibility when its check fails, and says nothing of a tracker without it (BTN-1134)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let fails = false
    const { view, refreshers } = start(['APP'], async () => ({
      chainTasks: async () => ({ tasks: [], statuses: [] }), tasks: async () => [], close: async () => {},
      isPublic: async () => {
        if (fails) throw new Error('github: HTTP 502')
        return true
      },
    }))
    await vi.waitFor(() => expect(view.openToAll?.APP).toBe(true))
    fails = true
    await refreshers.get('APP')!()
    expect(view.openToAll?.APP).toBe(true)
    const plain = start(['HUL'], async () => ({ chainTasks: async () => ({ tasks: [], statuses: [] }), tasks: async () => [], close: async () => {} }))
    await vi.waitFor(() => expect(plain.view.readAt.HUL).toBeDefined())
    expect(plain.view.openToAll).toBeUndefined()
  })

  it.each([false, true])('publishes label-write support after connecting (supported: %s)', async (supported) => {
    const { view } = start(['APP'], async () => ({
      chainTasks: async () => ({ tasks: [], statuses: [] }), tasks: async () => [], close: async () => {},
      ...(supported ? { relabel: async () => [] } : {}),
    }))
    await vi.waitFor(() => expect(view.health.state).toBe('live'))
    expect(view.relabel).toBe(supported)
  })

  it.each([false, true])('publishes a refused merged-task close and clears it after recovery (manual: %s)', async (manual) => {
    vi.spyOn(merged, 'mergedCommits').mockResolvedValue(['c1'])
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    let refused = true
    let closed = false
    const current = () => ({ ...task('APP-1'), status: closed ? { name: 'Done', category: 'Won' as const } : task('APP-1').status })
    const complete = vi.fn(async () => {
      if (refused) throw new Error('jira: HTTP 400: Due date required')
      const moved = !closed
      closed = true
      return moved
    })
    const { view, refreshers } = start(['APP'], async () => ({
      chainTasks: async () => ({ tasks: [current()], statuses: ['Todo', 'Done'] }),
      tasks: async () => [current()], complete, close: async () => {},
    }), { dispatcher: { setTasks: vi.fn(), setOutside: vi.fn(), released: () => [], setReleased: vi.fn(), held: () => ['APP-1'], preview: (_project: string, tasks: TrackerTask[]) => ({ tasks, blockers: [], current: undefined }) } as unknown as TrackerStartDeps['dispatcher'] })
    await vi.waitFor(() => expect(view.completionFailures?.APP).toHaveLength(1))
    expect(view.completionFailures?.APP?.[0]).toEqual({ code: 'tracker.completeRefused', params: { task: 'APP-1' }, detail: 'jira: HTTP 400: Due date required' })
    refused = false
    closed = manual
    await refreshers.get('APP')!()
    expect(view.completionFailures?.APP).toEqual([])
    expect(closed).toBe(true)
  })

  it('hands the page the parents, open, closed and those the chain ran, and keeps a ran parent out of the chain (BTN-1041)', async () => {
    const done = { name: 'Done', category: 'Won' as const }
    const setParents = vi.fn()
    const { deps } = start(['APP'], async () => ({
      chainTasks: async () => ({
        tasks: [{ ...task('APP-1'), subtasks: 2 }, { ...task('APP-2'), parent: 'APP-1' }, { ...task('APP-3'), subtasks: 1, status: done }],
        statuses: ['Todo', 'Done'],
      }),
      tasks: async () => [{ ...task('APP-4'), subtasks: 1, status: done }, { ...task('APP-5'), status: done }],
      close: async () => {},
    }), { ranSince: () => ['APP-4', 'APP-5'], parents: { setParents } })
    await vi.waitFor(() => expect(setParents).toHaveBeenCalled())
    expect(setParents.mock.calls[0]![1].map((row: { id: string; closedSubtasks: number }) => [row.id, row.closedSubtasks])).toEqual([
      ['APP-1', 1],
      ['APP-3', 1],
      ['APP-4', 1],
    ])
    expect((deps.tasksByProject.get('APP') ?? []).map((each) => each.id)).toEqual(['APP-2', 'APP-5'])
  })

  it('tells the chain which released tasks it read, not those released while the read was on its way', async () => {
    const released = ['APP-2']
    const setReleased = vi.fn()
    start(['APP'], async () => ({
      chainTasks: async () => ({ tasks: [task('APP-1')], statuses: ['Todo'] }),
      tasks: async () => {
        released.push('APP-3')
        return [task('APP-2')]
      },
      close: async () => {},
    }), { dispatcher: { setTasks: vi.fn(), setOutside: vi.fn(), released: () => [...released], setReleased, held: () => [], preview: (_project: string, tasks: TrackerTask[]) => ({ tasks, blockers: [], current: undefined }) } as unknown as TrackerStartDeps['dispatcher'] })
    await vi.waitFor(() => expect(setReleased).toHaveBeenCalled())
    expect(setReleased.mock.calls[0]).toEqual(['APP', [expect.objectContaining({ id: 'APP-2' })], ['APP-2']])
  })

  it('logs repeated status poll failures once and logs recovery once', async () => {
    vi.useFakeTimers()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {})
    let failing = true
    const tasks = vi.fn(async () => {
      if (failing) throw new Error('tracker unavailable')
      return [task('APP-1')]
    })
    start(['APP'], async () => ({
      chainTasks: async () => ({ tasks: [task('APP-1')], statuses: ['Todo'] }),
      tasks,
      close: async () => {},
    }))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(tasks).toHaveBeenCalledTimes(3)
    expect(errors).toHaveBeenCalledExactlyOnceWith('Huly: tracker unavailable')
    expect(logs).not.toHaveBeenCalled()

    failing = false
    await vi.advanceTimersByTimeAsync(10_000)
    expect(logs).toHaveBeenCalledExactlyOnceWith('Huly: reads again')
  })

  it.each([true, false])('publishes the milestone in the same read only after a successful assignment (%s)', async (assigned) => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const milestone = { label: 'v0.2', targetDate: 1_800_000_000_000 }
    const tasks = [{ ...task('ABC-1'), milestone }, task('ABC-2')]
    const chainTasks = vi.fn(async () => ({ tasks, statuses: ['Todo'] }))
    const setMilestone = vi.fn(async () => assigned)
    const broadcast = vi.fn()
    const { dispatcher, deps } = start(['ABC'], async () => ({ chainTasks, setMilestone, tasks: async () => [], close: async () => {} }), {
      fillsMilestone: () => true,
      broadcast,
    })
    dispatcher.preview.mockImplementation((_project: string, listed: TrackerTask[]) => ({ tasks: listed.map(toTask), blockers: [], current: 'ABC-1' }))
    await vi.waitFor(() => expect(setMilestone).toHaveBeenCalledWith('ABC-2', 'ABC-1'))
    await vi.waitFor(() => expect(broadcast).toHaveBeenCalled())
    const expected = assigned ? milestone : null
    expect(deps.tasksByProject.get('ABC')?.find((each) => each.id === 'ABC-2')?.milestone).toEqual(expected)
    // The list reaches the chain only with the assignment's outcome: never first without the milestone, then with it.
    for (const [, listed] of dispatcher.setTasks.mock.calls) {
      expect(listed.find((each: TrackerTask) => each.id === 'ABC-2')?.milestone).toEqual(expected)
    }
    expect(chainTasks).toHaveBeenCalledTimes(1)
  })

  it('gives a task the status poll brings into the chain its milestone before the chain gets it', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const milestone = { label: 'v0.2', targetDate: 1_800_000_000_000 }
    let readied = false
    const current = () => [
      { ...task('ABC-1'), milestone },
      { ...task('ABC-2'), status: readied ? task('ABC-2').status : { name: 'Backlog', category: 'UnStarted' as const } },
    ]
    const chainTasks = vi.fn(async () => ({ tasks: current(), statuses: ['Backlog', 'Todo'] }))
    const setMilestone = vi.fn(async () => true)
    const { dispatcher } = start(['ABC'], async () => ({ chainTasks, setMilestone, tasks: async () => current(), close: async () => {} }), {
      fillsMilestone: () => true,
    })
    dispatcher.preview.mockImplementation((_project: string, listed: TrackerTask[]) => ({
      tasks: listed.filter((each) => each.status.name === 'Todo').map(toTask),
      blockers: [],
      current: 'ABC-1',
    }))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(setMilestone).not.toHaveBeenCalled()

    readied = true
    await vi.advanceTimersByTimeAsync(5_000)
    expect(setMilestone).toHaveBeenCalledExactlyOnceWith('ABC-2', 'ABC-1')
    const entered = dispatcher.setTasks.mock.calls.map(([, listed]) => listed.find((each: TrackerTask) => each.id === 'ABC-2')).filter((each) => each.status.name === 'Todo')
    expect(entered.map((each) => each.milestone)).toEqual([milestone])
    expect(chainTasks).toHaveBeenCalledTimes(1)
  })

  it('reads the other projects of the profile when one of them is not in the tracker', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { view, dispatcher } = start(['APP', 'TSK'], async () => hulyLike(new Set(['APP'])))
    await vi.waitFor(() => expect(view.readAt.TSK).toBeDefined())
    expect(dispatcher.setTasks).toHaveBeenCalledWith('TSK', [expect.objectContaining({ id: 'TSK-1' })])
    expect(dispatcher.setTasks).not.toHaveBeenCalledWith('APP', expect.anything())
    expect(view.health.state).toBe('live')
  })

  it('logs a read that keeps failing the same way once, and once more when it reads again', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {})
    const missing = new Set(['APP'])
    const { view, refreshers } = start(['APP'], async () => hulyLike(missing))
    await vi.waitFor(() => expect(errors).toHaveBeenCalledTimes(1))
    await refreshers.get('APP')!()
    await refreshers.get('APP')!()
    expect(errors).toHaveBeenCalledTimes(1)
    expect(errors).toHaveBeenCalledWith('Huly: APP: huly: project APP not found')

    missing.clear()
    await refreshers.get('APP')!()
    expect(view.readAt.APP).toBeDefined()
    expect(logs).toHaveBeenCalledWith('Huly: APP reads again')
    await refreshers.get('APP')!()
    expect(logs).toHaveBeenCalledTimes(1)
  })

  it('says so each time the link turns live, so the profile is checked again (BTN-678)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let down = false
    const recovered = vi.fn()
    const { view, refreshers } = start(['APP'], async () => ({
      chainTasks: async () => {
        if (down) throw new Error('fetch failed')
        return { tasks: [], statuses: [] }
      },
      tasks: async () => [], close: async () => {},
    }), { recovered })
    await vi.waitFor(() => expect(recovered).toHaveBeenCalledTimes(1))
    expect(recovered).toHaveBeenCalledWith('huly')
    down = true
    await refreshers.get('APP')!()
    expect(view.health.state).toBe('down')
    await refreshers.get('APP')!()
    down = false
    await refreshers.get('APP')!()
    await refreshers.get('APP')!()
    expect(recovered).toHaveBeenCalledTimes(2)
  })
})
