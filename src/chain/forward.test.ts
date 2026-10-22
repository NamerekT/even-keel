import { describe, expect, it } from 'vitest'
import type { GitResult } from '../git/types.js'
import { notice, type Notice } from '../notice/notice.js'
import { chainQuiet, ForwardMerger, type ForwardPair } from './forward.js'
import { newChain, type ActiveChain } from './model.js'

const dev = '/home/john/even-keel'
const release = '/home/john/even-keel-release'
const ref = 'refs/even-keel/forward/EKR'
const fetch = `fetch --quiet ${release} +refs/heads/release/v0.1:${ref}`
const count = `rev-list --count refs/heads/dev..${ref}`
const merge = `merge --no-edit -m Merge branch 'release/v0.1' of EKR (release) into dev ${ref}`
const onDev = { 'symbolic-ref --quiet --short HEAD': { out: 'dev\n' } }

/** An answer given as a list is used up in order, the last one repeating. */
function setup(answers: Record<string, Partial<GitResult> | Partial<GitResult>[]> = {}, options: { quiet?: boolean; push?: Notice | null } = {}) {
  const calls: string[] = []
  const state = { quiet: options.quiet ?? true, pairs: [{ from: 'EKR', into: 'BTN' }] as ForwardPair[], changes: 0, syncs: 0 }
  const merger = new ForwardMerger({
    pairs: () => state.pairs,
    repo: (project) => (project === 'BTN' ? dev : release),
    branch: (project) => (project === 'BTN' ? 'dev' : 'release/v0.1'),
    label: (project) => `${project} (release)`,
    quiet: () => state.quiet,
    git: async (cwd, args) => {
      expect(cwd).toBe(dev)
      const command = args.join(' ')
      calls.push(command)
      const answer = answers[command]
      return { code: 0, out: '', ...(Array.isArray(answer) ? (answer.length > 1 ? answer.shift() : answer[0]) : answer) }
    },
    sync: async () => {
      state.syncs += 1
      return options.push ?? null
    },
    now: () => new Date('2026-10-22T10:00:00.000Z'),
    changed: () => {
      state.changes += 1
    },
    log: () => {},
  })
  return { merger, calls, state }
}

describe('chainQuiet', () => {
  const busy = (task: string) => task === 'BTN-2'
  const running = (task: string, extra: Partial<ActiveChain> = {}): ActiveChain => ({ ...newChain('BTN'), current: { task, sessionId: 's', since: '2026-10-22T09:00:00.000Z' }, ...extra })

  it('is quiet with no chain, an empty one, or a paused one whose session is not working', () => {
    expect(chainQuiet(undefined, busy)).toBe(true)
    expect(chainQuiet(newChain('BTN'), busy)).toBe(true)
    expect(chainQuiet(running('BTN-1', { paused: true }), busy)).toBe(true)
  })

  it('is not quiet while a task runs, a paused session works, or the chain cleans up or waits on main', () => {
    expect(chainQuiet(running('BTN-1'), busy)).toBe(false)
    expect(chainQuiet(running('BTN-2', { paused: true }), busy)).toBe(false)
    expect(chainQuiet({ ...newChain('BTN'), closing: 'BTN-1' }, busy)).toBe(false)
    expect(chainQuiet({ ...newChain('BTN'), ciWait: { commit: 'abc', since: '2026-10-22T09:00:00.000Z' } }, busy)).toBe(false)
  })
})

describe('ForwardMerger', () => {
  it('merges the release branch into the quiet dev branch and syncs it', async () => {
    const { merger, calls, state } = setup({ [count]: { out: '3\n' }, ...onDev })
    await merger.tick()
    expect(calls).toEqual([fetch, count, 'symbolic-ref --quiet --short HEAD', 'status --porcelain --untracked-files=no', merge])
    expect(state.syncs).toBe(1)
    expect(merger.view()).toEqual({ EKR: { into: 'BTN', behind: 0, hold: null, held: false, last: { at: '2026-10-22T10:00:00.000Z', commits: 3, push: null } } })
  })

  it('does nothing when the dev branch has every commit of the release branch', async () => {
    const { merger, calls, state } = setup({ [count]: { out: '0\n' } })
    await merger.tick()
    expect(calls).toEqual([fetch, count])
    expect(state.syncs).toBe(0)
    expect(merger.view().EKR).toEqual({ into: 'BTN', behind: 0, hold: null, held: false })
  })

  it('waits while the dev chain works, and carry now does not', async () => {
    const { merger, calls } = setup({ [count]: { out: '2\n' }, ...onDev }, { quiet: false })
    await merger.tick()
    expect(calls).not.toContain(merge)
    expect(merger.view().EKR).toMatchObject({ behind: 2, hold: notice('forward.busy', { into: 'BTN' }), held: false })
    await merger.carry('EKR')
    expect(calls).toContain(merge)
  })

  it('leaves a dev checkout that is off its branch or has changes alone', async () => {
    const off = setup({ [count]: { out: '1\n' }, 'symbolic-ref --quiet --short HEAD': { out: 'btn-9/task\n' } })
    await off.merger.tick()
    expect(off.calls).not.toContain(merge)
    expect(off.merger.view().EKR?.hold).toEqual(notice('forward.notOnBranch', { repo: dev, branch: 'dev', current: 'btn-9/task' }))

    const dirty = setup({ [count]: { out: '1\n' }, ...onDev, 'status --porcelain --untracked-files=no': { out: ' M src/a.ts\n' } })
    await dirty.merger.tick()
    expect(dirty.calls).not.toContain(merge)
    expect(dirty.merger.view().EKR?.hold).toEqual(notice('forward.dirty', { repo: dev }, { detail: ' M src/a.ts\n' }))
  })

  it('aborts a conflict, holds the forward merge until carry now, and lets the hold go once the dev branch has the commits', async () => {
    const { merger, calls, state } = setup({
      [count]: [{ out: '2\n' }, { out: '2\n' }, { out: '2\n' }, { out: '0\n' }],
      ...onDev,
      [merge]: [{ code: 1, out: 'CONFLICT (content): Merge conflict in src/a.ts' }, { code: 0 }],
      'diff --name-only --diff-filter=U': { out: 'src/a.ts\nsrc/b.ts\n' },
    })
    await merger.tick()
    expect(calls.slice(-2)).toEqual(['diff --name-only --diff-filter=U', 'merge --abort'])
    expect(state.syncs).toBe(0)
    expect(merger.view().EKR).toMatchObject({
      behind: 2,
      held: true,
      hold: notice('forward.conflict', { from: 'EKR', into: 'BTN', files: ['src/a.ts', 'src/b.ts'] }, { detail: 'CONFLICT (content): Merge conflict in src/a.ts' }),
    })

    calls.length = 0
    await merger.tick()
    expect(calls).toEqual([fetch, count])
    expect(merger.view().EKR?.held).toBe(true)

    await merger.carry('EKR')
    expect(state.syncs).toBe(1)
    expect(merger.view().EKR).toMatchObject({ behind: 0, held: false, hold: null })
  })

  it('keeps the failed push of a carry for the page', async () => {
    const failed = notice('sync.push', { remote: 'origin', main: 'dev' })
    const { merger } = setup({ [count]: { out: '1\n' }, ...onDev }, { push: failed })
    await merger.tick()
    expect(merger.view().EKR?.last?.push).toEqual(failed)
  })

  it('reports a fetch that failed and forgets a pair the config no longer has', async () => {
    const { merger, state } = setup({ [fetch]: { code: 128, out: 'fatal: not a git repository' } })
    await merger.tick()
    expect(merger.view().EKR?.hold).toEqual(notice('forward.fetch', { from: 'EKR' }, { detail: 'fatal: not a git repository' }))
    state.pairs = []
    await merger.tick()
    expect(merger.view()).toEqual({})
  })

  it('refuses carry now for a project that merges into none', async () => {
    const { merger } = setup()
    await expect(merger.carry('BTN')).rejects.toThrow(/BTN/)
  })
})
