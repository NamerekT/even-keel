import { describe, expect, it } from 'vitest'
import type { CiRun } from '../ci/model.js'
import type { CiVerdict } from '../ci/verdict.js'
import { notice } from '../notice/notice.js'
import { done, setup, task } from './dispatcher.fixture.js'
import { FIX_LISTED_MS } from './maincheck.js'
import type { MainCheckDeps, MainPush } from './model.js'
import type { NewTask } from '../tracker/source.js'

const failedRun: CiRun = {
  id: 7,
  number: 7,
  title: 'Merge',
  workflow: 'test.yml',
  commit: 'bbbbbbbbbb',
  status: 'failure',
  createdAt: '2026-09-26T12:00:05Z',
  startedAt: '2026-09-26T12:00:10Z',
  stoppedAt: '2026-09-26T12:02:00Z',
  url: 'https://ci.example.com/runs/7',
}

function fakeMain(wait: number | null = null) {
  const heads = ['bbbbbbbbbb', 'cccccccccc', 'dddddddddd']
  const ci = {
    verdict: { state: 'pending' } as CiVerdict,
    wait,
    created: [] as Omit<NewTask, 'project'>[],
    comments: [] as { task: string; body: string }[],
    prepared: [] as string[],
    reports: [] as { push: MainPush; green: string | null }[],
    canCreate: true,
    next: 9,
  }
  const deps: MainCheckDeps = {
    head: async () => heads.shift() ?? null,
    verdict: () => ci.verdict,
    waitMs: () => ci.wait,
    report: async (_project, push, _failed, green) => {
      ci.reports.push({ push: structuredClone(push), green })
      return { title: `CI on main failed: ${push.commit.slice(0, 7)}`, description: 'log', comment: 'more log' }
    },
    create: async (_project, created) => {
      if (!ci.canCreate) return null
      ci.created.push(created)
      return `ABC-${ci.next++}`
    },
    comment: async (id, body) => {
      ci.comments.push({ task: id, body })
    },
    prepare: async (project, id) => {
      ci.prepared.push(`${project}/${id}`)
    },
  }
  return { ci, deps }
}

async function afterDone(wait: number | null = null) {
  const { ci, deps } = fakeMain(wait)
  const harness = setup({ main: deps })
  const { dispatcher } = harness
  dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
  dispatcher.start('ABC')
  await dispatcher.idle()
  dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2'), task('ABC-3')])
  await dispatcher.idle()
  return { ...harness, ci }
}

describe('Dispatcher and the CI of main', () => {
  it('waits for the verdict on the push before the next launch, preparing the next task meanwhile', async () => {
    const { dispatcher, launched, ci } = await afterDone()
    expect(launched).toEqual(['ABC/ABC-1'])
    expect(dispatcher.state.ci.ABC?.check).toEqual({ commit: 'bbbbbbbbbb', at: '2026-09-26T12:00:00.000Z', tasks: ['ABC-1'] })
    expect(dispatcher.state.active[0]?.ciWait).toEqual({ commit: 'bbbbbbbbbb', since: '2026-09-26T12:00:00.000Z' })
    expect(ci.prepared).toEqual(['ABC/ABC-2'])

    dispatcher.check()
    await dispatcher.idle()
    expect(ci.prepared).toEqual(['ABC/ABC-2'])

    ci.verdict = { state: 'green' }
    dispatcher.check()
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(dispatcher.state.ci.ABC).toEqual({ green: 'bbbbbbbbbb' })
    expect(dispatcher.state.active[0]?.ciWait).toBeUndefined()
  })

  it('launches once the wait runs out and still reacts to the late verdict', async () => {
    const { dispatcher, launched, clock, ci } = await afterDone(10 * 60_000)
    expect(launched).toEqual(['ABC/ABC-1'])

    clock.now = new Date('2026-09-26T12:10:00Z')
    dispatcher.check()
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(dispatcher.state.ci.ABC?.check?.commit).toBe('bbbbbbbbbb')

    ci.verdict = { state: 'red', failed: [{ kind: 'forgejo', run: failedRun }] }
    dispatcher.check()
    await dispatcher.idle()
    expect(ci.created).toEqual([{ title: 'CI on main failed: bbbbbbb', description: 'log', priority: 'high', milestoneOf: 'ABC-1' }])
    expect(dispatcher.state.active[0]?.current?.task).toBe('ABC-2')
    expect(dispatcher.state.active[0]?.paused).toBe(false)
  })

  it('does not wait at all with a zero wait', async () => {
    const { launched } = await afterDone(0)
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
  })

  it('goes on when the CI cannot judge the push', async () => {
    const { dispatcher, launched, log, ci } = await afterDone()
    ci.verdict = { state: 'unavailable', reasons: [notice('ci.notTaken', { ci: 'Forgejo', commit: 'bbbbbbb' })] }
    dispatcher.check()
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(dispatcher.state.ci.ABC).toEqual({})
    expect(log).toContain('ci: ABC: bbbbbbb stays unchecked: Forgejo: no runner took bbbbbbb')
  })

  it('files a fix task for a red push and launches it before the rest', async () => {
    const { dispatcher, launched, clock, ci } = await afterDone()
    ci.verdict = { state: 'red', failed: [{ kind: 'forgejo', run: failedRun }] }
    dispatcher.check()
    await dispatcher.idle()
    expect(ci.created).toHaveLength(1)
    expect(ci.reports).toEqual([{ push: { commit: 'bbbbbbbbbb', at: '2026-09-26T12:00:00.000Z', tasks: ['ABC-1'] }, green: null }])
    expect(dispatcher.state.ci.ABC?.fix).toEqual({ task: 'ABC-9', at: '2026-09-26T12:00:00.000Z', commit: 'bbbbbbbbbb' })
    expect(launched).toEqual(['ABC/ABC-1'])

    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2'), task('ABC-3'), task('ABC-9')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-9'])

    ci.verdict = { state: 'pending' }
    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2'), task('ABC-3'), task('ABC-9', done)])
    await dispatcher.idle()
    expect(dispatcher.state.ci.ABC?.check).toEqual({ commit: 'cccccccccc', at: clock.now.toISOString(), tasks: ['ABC-9'] })

    ci.verdict = { state: 'green' }
    dispatcher.check()
    await dispatcher.idle()
    expect(dispatcher.state.ci.ABC).toEqual({ green: 'cccccccccc' })
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-9', 'ABC/ABC-2'])
  })

  it('waits a while for the tracker to list the fix task, then goes on', async () => {
    const { dispatcher, launched, clock, ci } = await afterDone()
    ci.verdict = { state: 'red', failed: [{ kind: 'forgejo', run: failedRun }] }
    dispatcher.check()
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1'])

    clock.now = new Date(Date.parse('2026-09-26T12:00:00Z') + FIX_LISTED_MS)
    dispatcher.check()
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
  })

  it('adds the log to the fix task still open instead of filing another', async () => {
    const { dispatcher, launched, ci } = await afterDone(0)
    ci.verdict = { state: 'red', failed: [{ kind: 'forgejo', run: failedRun }] }
    dispatcher.check()
    await dispatcher.idle()
    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2', done), task('ABC-3'), task('ABC-9')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2', 'ABC/ABC-9'])
    expect(dispatcher.state.ci.ABC?.check?.commit).toBe('cccccccccc')
    dispatcher.check()
    await dispatcher.idle()

    expect(ci.created).toHaveLength(1)
    expect(ci.comments).toEqual([{ task: 'ABC-9', body: 'more log' }])
  })

  it('stops the chain when the push of the fix is red too', async () => {
    const { dispatcher, launched, ci } = await afterDone()
    ci.verdict = { state: 'red', failed: [{ kind: 'forgejo', run: failedRun }] }
    dispatcher.check()
    await dispatcher.idle()
    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2'), task('ABC-3'), task('ABC-9')])
    await dispatcher.idle()
    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2'), task('ABC-3'), task('ABC-9', done)])
    await dispatcher.idle()
    dispatcher.check()
    await dispatcher.idle()

    expect(ci.created).toHaveLength(1)
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-9'])
    expect(dispatcher.state.active[0]).toMatchObject({ paused: true, error: notice('ci.fixFailed', { task: 'ABC-9', commit: 'ccccccc' }) })
    expect(dispatcher.state.ci.ABC).toEqual({})
  })

  it('shows the stop on a chain that had already ended', async () => {
    const { ci, deps } = fakeMain()
    const { dispatcher } = setup({ main: deps })
    dispatcher.state.ci.ABC = { check: { commit: 'eeeeeeeeee', at: '2026-09-26T11:59:00Z', tasks: ['ABC-9'] }, fix: { task: 'ABC-9', at: '2026-09-26T11:30:00Z', commit: 'aaaaaaaaaa' } }
    ci.verdict = { state: 'red', failed: [{ kind: 'forgejo', run: failedRun }] }
    dispatcher.setTasks('ABC', [task('ABC-9', done)])
    await dispatcher.idle()
    expect(dispatcher.state.active).toEqual([expect.objectContaining({ project: 'ABC', paused: true, error: notice('ci.fixFailed', { task: 'ABC-9', commit: 'eeeeeee' }) })])
  })

  it('pauses the chain when the tracker cannot create the fix task', async () => {
    const { dispatcher, ci } = await afterDone()
    ci.canCreate = false
    ci.verdict = { state: 'red', failed: [{ kind: 'forgejo', run: failedRun }] }
    dispatcher.check()
    await dispatcher.idle()
    expect(dispatcher.state.active[0]).toMatchObject({ paused: true, error: notice('ci.cannotCreate', { commit: 'bbbbbbb' }) })
  })

  it('waits for the latest of two pushes with the tasks of both', async () => {
    const { ci, deps } = fakeMain(0)
    const { dispatcher } = setup({ main: deps })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2'), task('ABC-3')])
    await dispatcher.idle()
    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2', done), task('ABC-3')])
    await dispatcher.idle()
    expect(dispatcher.state.ci.ABC?.check).toMatchObject({ commit: 'cccccccccc', tasks: ['ABC-1', 'ABC-2'] })
    expect(ci.verdict.state).toBe('pending')
  })
})
