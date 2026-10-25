import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_RULES } from '../chain/rules.js'
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
  vi.restoreAllMocks()
})

function start(projects: string[], connect: () => Promise<TaskSource>, overrides: Partial<TrackerStartDeps> = {}) {
  const view: TrackerView = { name: 'huly', kind: 'huly', title: 'Huly', projects, ready: false, health: { state: 'connecting', lastOkAt: null, error: null }, readAt: {} }
  const setup: TrackerSetup = { connect, issueUrl: () => null } as unknown as TrackerSetup
  const dispatcher = { setTasks: vi.fn(), setOutside: vi.fn(), released: () => [], setReleased: vi.fn(), held: () => [], view: vi.fn() }
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
    dispatcher.view.mockImplementation(() => ({ tasks: tasks.map(toTask), blockers: [], current: 'ABC-1' }))
    await vi.waitFor(() => expect(setMilestone).toHaveBeenCalledWith('ABC-2', 'ABC-1'))
    await vi.waitFor(() => expect(broadcast).toHaveBeenCalled())
    const expected = assigned ? milestone : null
    expect(deps.tasksByProject.get('ABC')?.find((each) => each.id === 'ABC-2')?.milestone).toEqual(expected)
    expect(dispatcher.setTasks.mock.lastCall?.[1].find((each: TrackerTask) => each.id === 'ABC-2')?.milestone).toEqual(expected)
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
})
