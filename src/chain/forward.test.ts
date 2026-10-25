import { describe, expect, it } from 'vitest'
import type { GitResult } from '../git/types.js'
import { notice, type Notice } from '../notice/notice.js'
import { chainQuiet, ForwardMerger, type CarryAsk, type ForwardPair } from './forward.js'
import { newChain, type ActiveChain } from './model.js'

const dev = '/home/john/even-keel'
const release = '/home/john/even-keel-release'
const ref = 'refs/even-keel/forward/EKR'
const fetch = `fetch --quiet ${release} +refs/heads/release/v0.1:${ref}`
const count = `rev-list --count refs/heads/dev..${ref}`
const merge = `merge --no-edit -m Merge branch 'release/v0.1' of EKR (release) into dev ${ref}`
const onDev = { 'symbolic-ref --quiet --short HEAD': { out: 'dev\n' } }
const carried = 'rev-parse --verify --quiet refs/heads/dev^{commit}'
const pushedRef = 'refs/even-keel/forward-push/EKR'
const fetchPush = (remote: string) => `fetch --no-tags --quiet ${remote} +refs/heads/dev:${pushedRef}`
const containsCarry = `merge-base --is-ancestor carry-commit ${pushedRef}`

/** An answer given as a list is used up in order, the last one repeating. */
function setup(answers: Record<string, Partial<GitResult> | Partial<GitResult>[]> = {}, options: { quiet?: boolean; push?: Notice | null; auto?: boolean } = {}) {
  const calls: string[] = []
  const state = {
    quiet: options.quiet ?? true,
    pairs: [{ from: 'EKR', into: 'BTN' }] as ForwardPair[],
    changes: 0,
    syncs: 0,
    same: true as boolean | undefined,
    agent: null as string | null,
    asked: [] as [string, CarryAsk][],
  }
  const merger = new ForwardMerger({
    pairs: () => state.pairs,
    sameRepository: () => state.same,
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
    carrying: () => state.agent,
    auto: () => options.auto ?? false,
    resolve: async (from, ask) => {
      state.asked.push([from, ask])
      state.agent = 'EKR-CARRY'
    },
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
    expect(calls).toEqual([fetch, count, 'symbolic-ref --quiet --short HEAD', 'status --porcelain --untracked-files=no', merge, carried])
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

  it('holds a merge that failed with no conflicted file as a failure, not a conflict, with git\'s message', async () => {
    const identity = 'Committer identity unknown\n\n*** Please tell me who you are.'
    const { merger, calls, state } = setup({ [count]: { out: '1\n' }, ...onDev, [merge]: { code: 128, out: identity } })
    await merger.tick()
    expect(calls.slice(-2)).toEqual(['diff --name-only --diff-filter=U', 'merge --abort'])
    expect(state.syncs).toBe(0)
    expect(merger.view().EKR).toMatchObject({ behind: 1, held: true, hold: notice('forward.failed', { from: 'EKR', into: 'BTN' }, { detail: identity }) })
  })

  it('keeps the failed push of a carry for the page', async () => {
    const failed = notice('sync.push', { remote: 'origin', main: 'dev' })
    const { merger } = setup({ [count]: { out: '1\n' }, ...onDev }, { push: failed })
    await merger.tick()
    expect(merger.view().EKR?.last?.push).toEqual(failed)
  })

  it('clears a failed push on a later tick once every remote has the carry, even while the chain works', async () => {
    const failed = notice('sync.alias', { exit: 1 })
    const { merger, calls, state } = setup({
      [count]: [{ out: '1\n' }, { out: '0\n' }],
      ...onDev,
      [carried]: { out: 'carry-commit\n' },
      remote: { out: 'origin\nmirror\n' },
      [containsCarry]: [{ code: 0 }, { code: 1 }, { code: 0 }, { code: 0 }],
    }, { push: failed })
    await merger.tick()
    const before = merger.view().EKR!.last!
    state.quiet = false
    await merger.tick()
    expect(merger.view().EKR?.last?.push).toEqual(failed)
    const changes = state.changes
    calls.length = 0
    await merger.tick()
    expect(merger.view().EKR?.last).toEqual({ ...before, push: null })
    expect(before.push).toEqual(failed)
    expect(state.changes).toBe(changes + 1)
    expect(state.syncs).toBe(1)
    expect(calls).toContain(fetchPush('origin'))
    expect(calls).toContain(fetchPush('mirror'))
    expect(calls).not.toContain(carried)
    calls.length = 0
    await merger.tick()
    expect(calls).toEqual([fetch, count])
  })

  it.each([
    { remote: { code: 128, out: 'remote read failed' } },
    { remote: { out: '' } },
    { remote: { out: 'origin\n' }, [fetchPush('origin')]: { code: 128, out: 'offline' } },
    { remote: { out: 'origin\n' }, [containsCarry]: { code: 128, out: 'missing object' } },
  ])('keeps the failed push when remote containment cannot be confirmed: %j', async (answers) => {
    const failed = notice('sync.push', { remote: 'origin', main: 'dev' })
    const { merger } = setup({
      [count]: [{ out: '1\n' }, { out: '0\n' }],
      ...onDev,
      [carried]: { out: 'carry-commit\n' },
      ...answers,
    }, { push: failed })
    await merger.tick()
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

  it('fetches nothing from a checkout of another repository, and waits for the remotes to be read', async () => {
    const { merger, calls, state } = setup({ [count]: { out: '3\n' }, ...onDev })
    state.same = false
    await merger.carry('EKR')
    expect(calls).toEqual([])
    expect(merger.view().EKR?.hold).toEqual(notice('forward.foreign', { from: 'EKR', into: 'BTN' }))
    state.same = undefined
    await merger.tick()
    expect(calls).toEqual([])
  })

  it('refuses carry now for a project that merges into none', async () => {
    const { merger } = setup()
    await expect(merger.carry('BTN')).rejects.toThrow(/BTN/)
  })

  describe('a conflict resolved by an agent (BTN-369)', () => {
    const conflicted = {
      [count]: [{ out: '2\n' }],
      ...onDev,
      [merge]: { code: 1, out: 'CONFLICT (content): Merge conflict in src/a.ts' },
      'diff --name-only --diff-filter=U': { out: 'src/a.ts\n' },
      [`rev-parse --verify --quiet ${ref}^{commit}`]: { out: 'abc1234def\n' },
    }

    it('asks for the carry session with what conflicts and what to merge, and shows the agent at work', async () => {
      const { merger, state } = setup(conflicted)
      await merger.tick()
      await merger.resolve('EKR')
      expect(state.asked).toEqual([
        ['EKR', { into: 'BTN', ref, commit: 'abc1234def', commits: 2, files: ['src/a.ts'], output: 'CONFLICT (content): Merge conflict in src/a.ts' }],
      ])
      expect(merger.view().EKR).toMatchObject({ held: true, agent: 'EKR-CARRY' })
    })

    it('merges nothing itself while the agent works, carry now included, and lets the hold go once the branch has the commits', async () => {
      const { merger, calls, state } = setup({ ...conflicted, [count]: [{ out: '2\n' }, { out: '2\n' }, { out: '0\n' }] })
      await merger.tick()
      state.agent = 'EKR-CARRY'
      calls.length = 0
      await merger.tick()
      expect(calls).toEqual([fetch, count])
      await expect(merger.carry('EKR')).rejects.toThrow(/EKR-CARRY/)
      await merger.tick()
      expect(merger.view().EKR).toMatchObject({ behind: 0, held: false, hold: null })
    })

    it('is asked for only on a held conflict', async () => {
      const failed = setup({ [count]: { out: '1\n' }, ...onDev, [merge]: { code: 128, out: 'fatal: no identity' } })
      await failed.merger.tick()
      await expect(failed.merger.resolve('EKR')).rejects.toThrow(/EKR/)
      const quiet = setup({ [count]: { out: '0\n' } })
      await quiet.merger.tick()
      await expect(quiet.merger.resolve('EKR')).rejects.toThrow(/EKR/)
      expect([...failed.state.asked, ...quiet.state.asked]).toEqual([])
    })
  })

  describe('a conflict given to the agent by itself (BTN-370)', () => {
    const conflict = { code: 1, out: 'CONFLICT (content): Merge conflict in src/a.ts' }
    const conflicted = (commits: string[]) => ({
      [count]: { out: '2\n' },
      ...onDev,
      [merge]: conflict,
      'diff --name-only --diff-filter=U': { out: 'src/a.ts\n' },
      [`rev-parse --verify --quiet ${ref}^{commit}`]: commits.map((out) => ({ out: `${out}\n` })),
    })

    it('asks for the carry session as soon as the merge conflicts', async () => {
      const { merger, state } = setup(conflicted(['abc1234def']), { auto: true })
      await merger.tick()
      expect(state.asked).toEqual([['EKR', { into: 'BTN', ref, commit: 'abc1234def', commits: 2, files: ['src/a.ts'], output: conflict.out }]])
      expect(merger.view().EKR).toMatchObject({ held: true, agent: 'EKR-CARRY' })
    })

    it('leaves the conflict for the button while the setting is off, and a failure that is no conflict always', async () => {
      const off = setup(conflicted(['abc1234def']))
      await off.merger.tick()
      const failed = setup({ [count]: { out: '1\n' }, ...onDev, [merge]: { code: 128, out: 'fatal: no identity' } }, { auto: true })
      await failed.merger.tick()
      expect([...off.state.asked, ...failed.state.asked]).toEqual([])
    })

    it('asks no second session for the same release commit, and tries again once the release branch moved', async () => {
      const { merger, calls, state } = setup(conflicted(['abc1234def', 'abc1234def', 'abc1234def', 'fed4321cba']), { auto: true })
      await merger.tick()
      state.agent = null
      calls.length = 0
      await merger.tick()
      expect(calls).not.toContain(merge)
      await merger.carry('EKR')
      expect(state.asked).toHaveLength(1)
      await merger.tick()
      expect(state.asked.map(([, ask]) => ask.commit)).toEqual(['abc1234def', 'fed4321cba'])
    })
  })
})
