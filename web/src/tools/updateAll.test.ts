import { describe, expect, it } from 'vitest'
import { NoticeError, type Notice } from '../../../src/notice/notice.js'
import type { PackagesView, PackageView } from '../../../src/state.js'
import { UpdateAllRuns, unshownFailures } from './updateAll.js'

const pkg = (name: string, over: Partial<PackageView> = {}): PackageView => ({
  name, kind: 'plugin', installed: true, version: '1.0.0', latest: null, fetched: null, installing: false, error: null, note: null,
  default: false, settings: {}, servers: [], unpinned: [], scripts: null, extras: false, removed: false, builtIn: false, ...over,
})

const view = (packages: PackageView[]) => ({ packages }) as unknown as PackagesView

const PENDING = [
  { name: 'agent-bridge@even-keel', command: 'packages/update' as const },
  { name: 'tasks@even-keel', command: 'packages/update' as const },
]

function deferred() {
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<void>((yes, no) => ((resolve = yes), (reject = no)))
  return { promise, resolve, reject }
}

describe('Update all (BTN-1480)', () => {
  it('goes on to the second row after the first, a built-in one, is updated', async () => {
    const runs = new UpdateAllRuns()
    const sent: string[] = []
    await runs.run(PENDING, async (_, body) => void sent.push(body.name))
    expect(sent).toEqual(['agent-bridge@even-keel', 'tasks@even-keel'])
    expect(runs.current()?.steps.map((step) => step.state)).toEqual(['done', 'done'])
    expect(runs.current()?.finished).toBe(true)
  })

  it('shows which row it is on while a command is in flight', async () => {
    const runs = new UpdateAllRuns()
    const first = deferred()
    const done = runs.run(PENDING, () => first.promise)
    expect(runs.current()?.steps.map((step) => step.state)).toEqual(['running', 'waiting'])
    expect(runs.current()?.finished).toBe(false)
    first.resolve()
    await done
  })

  it('keeps its progress and the failure of a later row for the catalog mounted again', async () => {
    const runs = new UpdateAllRuns()
    const second = deferred()
    const seen: (string | undefined)[] = []
    const unsubscribe = runs.subscribe(() => seen.push(runs.current()?.steps.find((step) => step.state === 'running')?.name))
    const done = runs.run(PENDING, async (_, body) => (body.name === 'tasks@even-keel' ? second.promise : undefined))
    // The section is left: its listener goes, the run does not.
    unsubscribe()
    await Promise.resolve()
    second.reject(new NoticeError({ code: 'packages.busy', params: { name: 'tasks@even-keel' } }))
    await done
    expect(seen[0]).toBe('agent-bridge@even-keel')
    const run = runs.current()!
    expect(run.finished).toBe(true)
    expect(run.steps[1]).toMatchObject({ name: 'tasks@even-keel', state: 'failed', notice: { code: 'packages.busy' } })
  })

  it('starts no second run while one goes', async () => {
    const runs = new UpdateAllRuns()
    const first = deferred()
    const sent: string[] = []
    const done = runs.run(PENDING, async (_, body) => {
      sent.push(body.name)
      await first.promise
    })
    await runs.run(PENDING.slice(1), async (_, body) => void sent.push(`again ${body.name}`))
    first.resolve()
    await done
    expect(sent).toEqual(['agent-bridge@even-keel', 'tasks@even-keel'])
  })

  it('tells its listeners of every step', async () => {
    const runs = new UpdateAllRuns()
    let calls = 0
    runs.subscribe(() => calls++)
    await runs.run(PENDING, async () => {})
    expect(calls).toBe(3)
  })
})

describe('unshownFailures', () => {
  const failed: Notice = { code: 'packages.busy', params: { name: 'tasks@even-keel' } }
  const run = {
    finished: true,
    steps: [
      { ...PENDING[0]!, state: 'done' as const, notice: null },
      { ...PENDING[1]!, state: 'failed' as const, notice: failed },
    ],
  }

  it('names a failed row that still waits and shows no error of its own', () => {
    expect(unshownFailures(run, view([pkg('agent-bridge@even-keel'), pkg('tasks@even-keel', { latest: '0.2.10' })]))).toEqual([{ name: 'tasks@even-keel', notice: failed }])
  })

  it('leaves out a row whose own error shows it, one updated since and one gone', () => {
    const error: Notice = { code: 'packages.copyFailed', params: { name: 'tasks@even-keel' } }
    expect(unshownFailures(run, view([pkg('tasks@even-keel', { latest: '0.2.10', error })]))).toEqual([])
    expect(unshownFailures(run, view([pkg('tasks@even-keel')]))).toEqual([])
    expect(unshownFailures(run, view([]))).toEqual([])
  })

  it('names none while the run goes', () => {
    expect(unshownFailures({ ...run, finished: false }, view([pkg('tasks@even-keel', { latest: '0.2.10' })]))).toEqual([])
    expect(unshownFailures(null, view([]))).toEqual([])
  })
})
