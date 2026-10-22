import { describe, expect, it } from 'vitest'
import type { CiKind, CiRun, CiView } from '../ci/model.js'
import type { Git } from '../git/types.js'
import type { CiSettings } from '../state.js'
import { mainCheckDeps, mergeCheck, type MainCiWatch } from './mainci.js'
import type { CheckFailure } from './model.js'

const run = (kind: CiKind, status: CiRun['status']): CiRun => ({
  id: kind === 'github' ? 1 : 2,
  number: 5,
  title: 'Merge',
  workflow: 'CI',
  commit: 'c2',
  status,
  createdAt: '2026-10-12T10:00:00Z',
  startedAt: '2026-10-12T10:00:00Z',
  stoppedAt: '2026-10-12T10:02:00Z',
  url: `https://example.com/${kind}/runs/5`,
})

const view = (kind: CiKind, status: CiRun['status']): CiView => ({
  kind,
  remote: kind === 'github' ? 'github' : 'origin',
  url: 'https://example.com',
  health: 'ok',
  error: null,
  checkedAt: '2026-10-12T10:03:00Z',
  current: { run: run(kind, status), tasks: [], jobs: [] },
  history: [],
  medianMs: null,
  pushed: null,
})

const all = (kinds: CiKind[], waitMinutes: number | null = null): CiSettings => ({ guard: true, kinds, waitMinutes, recheckMain: true, fixTask: false })
const unguarded = (kinds: CiKind[]): CiSettings => ({ ...all(kinds), guard: false })

/** `views: null` — the service has yet to find the project's CIs. */
function setup(settings: CiSettings, views: CiView[] | null, heads: Record<string, string> = {}, failure: CheckFailure | null = null, main = 'main') {
  const gitCalls: string[][] = []
  const checks: string[] = []
  const git: Git = async (cwd, args) => {
    gitCalls.push(args)
    if (args[0] === 'rev-parse') {
      const ref = args.at(-1)!
      if (ref.endsWith('^{tree}')) return { code: 0, out: `tree-${ref.slice(0, -7)}\n` }
      const head = heads[`${cwd} ${ref}`]
      return head === undefined ? { code: 0, out: 'c2\n' } : { code: 0, out: `${head}\n` }
    }
    if (args[0] === 'symbolic-ref') {
      const branch = heads[`${cwd} branch`] ?? 'main'
      return branch === '' ? { code: 1, out: '' } : { code: 0, out: `${branch}\n` }
    }
    if (args[0] === 'for-each-ref') return { code: 0, out: args.at(-1) === 'refs/heads/abc-1' ? 'b1\n' : '' }
    return { code: 0, out: 'c2abc [ABC-2] Second\nc1abc [ABC-1] First\n' }
  }
  const watches: MainCiWatch[] | null =
    views?.map((each) => ({ view: each, failed: async (failed) => ({ kind: each.kind, run: failed, jobs: [], log: 'FAIL' }) })) ?? null
  const deps = mainCheckDeps({
    peers: () => ['XYZ'],
    repo: () => 'D:/repos/abc',
    main: () => main,
    git,
    watches: () => watches,
    settings: () => settings,
    commands: () => ['npm test'],
    language: () => 'en',
    promptLanguage: () => 'ru',
    create: async () => 'ABC-9',
    comment: async () => {},
    prepare: async () => {},
    place: async (_project, task) => `D:/repos/abc/.claude/worktrees/${task.toLowerCase()}`,
    runCheck: async (_project, task, cwd) => {
      checks.push(`${task} in ${cwd}`)
      return failure
    },
    afterGreen: () => ['npm run build'],
    runAfterGreen: async (project, cwd) => {
      checks.push(`afterGreen of ${project} in ${cwd}`)
      return failure
    },
    now: () => new Date('2026-10-12T10:05:00Z'),
  })
  return { deps, gitCalls, checks }
}

describe('mainCheckDeps', () => {
  it('reads main of the project checkout', async () => {
    const { deps } = setup(all(['forgejo', 'github']), [])
    expect(await deps.head('ABC')).toBe('c2')
  })

  it('reads the project’s main branch and checks the next task’s place against it when it is not main', async () => {
    const place = 'D:/repos/abc/.claude/worktrees/abc-2'
    const { deps, gitCalls } = setup(all([]), [], { [`${place} HEAD`]: 'c3', 'D:/repos/abc refs/heads/master': 'c3' }, null, 'master')
    expect(await deps.head('ABC')).toBe('c3')
    expect(gitCalls[0]).toEqual(['rev-parse', '--verify', '--quiet', 'refs/heads/master'])
    expect(await deps.checkMain('ABC', 'ABC-2', 'c3')).toEqual({ state: 'green' })
  })

  it('counts only the CIs the project settings name', () => {
    const views = [view('forgejo', 'failure'), view('github', 'success')]
    expect(setup(all(['github']), views).deps.verdict('ABC', 'c2', '2026-10-12T10:00:00Z')).toEqual({ state: 'green' })
    expect(setup(all(['forgejo', 'github']), views).deps.verdict('ABC', 'c2', '2026-10-12T10:00:00Z').state).toBe('red')
    expect(setup(all([]), views).deps.verdict('ABC', 'c2', '2026-10-12T10:00:00Z')).toEqual({ state: 'none' })
  })

  it('waits for the verdict until the service has found the project CIs, so a push is not taken for one without a CI', () => {
    expect(setup(all(['forgejo']), null).deps.verdict('ABC', 'c2', '2026-10-12T10:00:00Z')).toEqual({ state: 'pending' })
    expect(setup(unguarded(['forgejo']), null).deps.verdict('ABC', 'c2', '2026-10-12T10:00:00Z')).toEqual({ state: 'none' })
  })

  it('has no projects of one remote with the guard of main off', () => {
    expect(setup(all([]), []).deps.peers('ABC')).toEqual(['XYZ'])
    expect(setup(unguarded([]), []).deps.peers('ABC')).toEqual([])
  })

  it('turns the wait into milliseconds, null staying as long as it takes', () => {
    expect(setup(all([]), []).deps.waitMs('ABC')).toBeNull()
    expect(setup(all([], 0), []).deps.waitMs('ABC')).toBe(0)
    expect(setup(all([], 15), []).deps.waitMs('ABC')).toBe(900_000)
  })

  it('reports the failed runs with the commits since the last green one', async () => {
    const { deps, gitCalls } = setup(all(['github']), [view('github', 'failure')])
    const push = { commit: 'c2', at: '2026-10-12T10:00:00Z', tasks: ['ABC-1', 'ABC-2'] }
    const report = await deps.report('ABC', push, { ci: [{ kind: 'github', run: run('github', 'failure') }] }, 'c0')
    expect(gitCalls.at(-1)).toEqual(['log', '--format=%h %s', '-50', 'c0..c2'])
    expect(report.title).toBe('CI on main failed: c2')
    expect(report.description).toContain('c1abc [ABC-1] First')
    expect(report.description).toContain('```text\nFAIL\n```')
  })

  it('takes the latest commits of main when no green one is known', async () => {
    const { deps, gitCalls } = setup(all(['github']), [view('github', 'failure')])
    await deps.report('ABC', { commit: 'c2', at: '2026-10-12T10:00:00Z', tasks: [] }, { ci: [{ kind: 'github', run: run('github', 'failure') }] }, null)
    expect(gitCalls.at(-1)).toEqual(['log', '--format=%h %s', '-20', 'c2'])
  })

  it('reports a failed project check by its command and output', async () => {
    const { deps } = setup(all([]), [])
    const report = await deps.report('ABC', { commit: 'c2', at: '2026-10-12T10:00:00Z', tasks: ['ABC-2'] }, { check: { command: 'npm test', code: 1, output: 'FAIL' } }, 'c0')
    expect(report.title).toBe('Check of main failed: c2')
    expect(report.description).toContain('`npm test` exited with code 1.')
    expect(report.prompt).toContain('`npm test` завершилась с кодом 1.')
  })

  it('reads from the project settings whether a red main gets a fix task', () => {
    expect(setup(all([]), []).deps.fixTask('ABC')).toBe(false)
    expect(setup({ ...all([]), fixTask: true }, []).deps.fixTask('ABC')).toBe(true)
  })

  it('reads the tree of the task branch, whatever its tail', async () => {
    const { deps, gitCalls } = setup(all([]), [])
    expect(await deps.taskTree('ABC', 'ABC-1')).toBe('tree-b1')
    expect(gitCalls[0]).toEqual(['for-each-ref', '--format=%(objectname)', 'refs/heads/abc-1'])
    expect(await deps.taskTree('ABC', 'ABC-2')).toBeNull()
    expect(await deps.tree('ABC', 'c2')).toBe('tree-c2')
  })

  it('gives the check commands and whether main is checked again', () => {
    expect(setup(all([]), []).deps.checking('ABC')).toEqual({ commands: ['npm test'], recheck: true })
    expect(setup({ ...all([]), recheckMain: false }, []).deps.checking('ABC')).toEqual({ commands: ['npm test'], recheck: false })
  })

  it('runs the check of main in the place of the next task when it stands on main', async () => {
    const place = 'D:/repos/abc/.claude/worktrees/abc-2'
    const green = setup(all([]), [], { [`${place} HEAD`]: 'c2', 'D:/repos/abc refs/heads/main': 'c2' })
    expect(await green.deps.checkMain('ABC', 'ABC-2', 'c2')).toEqual({ state: 'green' })
    expect(green.checks).toEqual([`ABC-2 in ${place}`])

    const failure = { command: 'npm test', code: 1, output: 'FAIL' }
    const red = setup(all([]), [], { [`${place} HEAD`]: 'c2', 'D:/repos/abc refs/heads/main': 'c2' }, failure)
    expect(await red.deps.checkMain('ABC', 'ABC-2', 'c2')).toEqual({ state: 'red', failure })

    const own = setup(all([]), [], { [`${place} HEAD`]: 'b7', 'D:/repos/abc refs/heads/main': 'c2' })
    expect(await own.deps.checkMain('ABC', 'ABC-2', 'c2')).toEqual({ state: 'skipped', reason: `the place of ABC-2 (${place}) is not on main` })
    expect(own.checks).toEqual([])
  })

  it('judges nothing when the guard of main is off: no CI counts, no check runs', async () => {
    const place = 'D:/repos/abc/.claude/worktrees/abc-2'
    const { deps, checks } = setup(unguarded(['github']), [view('github', 'failure')], { [`${place} HEAD`]: 'c2', 'D:/repos/abc refs/heads/main': 'c2' })
    expect(deps.verdict('ABC', 'c2', '2026-10-12T10:00:00Z')).toEqual({ state: 'none' })
    expect(deps.checking('ABC')).toEqual({ commands: [], recheck: true })
    expect(await deps.checkMain('ABC', 'ABC-2', 'c2')).toEqual({ state: 'skipped', reason: 'the guard of main is off' })
    expect(deps.afterGreen('ABC')).toBe(false)
    expect(checks).toEqual([])
  })

  it('runs the commands after a green main in the project checkout only when it is on main at that commit', async () => {
    const repo = 'D:/repos/abc'
    const done = setup(all([]), [], { [`${repo} HEAD`]: 'c2' })
    expect(done.deps.afterGreen('ABC')).toBe(true)
    expect(await done.deps.runAfterGreen('ABC', 'c2')).toEqual({ state: 'done' })
    expect(done.checks).toEqual([`afterGreen of ABC in ${repo}`])

    const failure = { command: 'npm run build', code: 2, output: 'error' }
    expect(await setup(all([]), [], { [`${repo} HEAD`]: 'c2' }, failure).deps.runAfterGreen('ABC', 'c2')).toEqual({ state: 'failed', failure })

    const moved = setup(all([]), [], { [`${repo} HEAD`]: 'c3abcdef12' })
    expect(await moved.deps.runAfterGreen('ABC', 'c2')).toEqual({ state: 'skipped', reason: `the checkout ${repo} is at c3abcde, past the green commit` })
    const elsewhere = setup(all([]), [], { [`${repo} HEAD`]: 'c2', [`${repo} branch`]: 'dev' })
    expect(await elsewhere.deps.runAfterGreen('ABC', 'c2')).toEqual({ state: 'skipped', reason: `the checkout ${repo} is on dev, not on main` })
    const detached = setup(all([]), [], { [`${repo} HEAD`]: 'c2', [`${repo} branch`]: '' })
    expect(await detached.deps.runAfterGreen('ABC', 'c2')).toEqual({ state: 'skipped', reason: `the checkout ${repo} is on no branch, not on main` })
    expect([...moved.checks, ...elsewhere.checks, ...detached.checks]).toEqual([])
  })
})

describe('mergeCheck', () => {
  const healthy = view('github', 'success')
  const down: CiView = { ...view('forgejo', 'success'), health: 'error' }

  it('asks for the check before the merge only when no counted CI will judge main', () => {
    expect(mergeCheck(['npm test'], all([]), [healthy])).toEqual(['npm test'])
    expect(mergeCheck(['npm test'], all(['github']), [])).toEqual(['npm test'])
    expect(mergeCheck(['npm test'], all(['github']), [healthy])).toEqual([])
    expect(mergeCheck(['npm test'], all(['github', 'forgejo']), [healthy, down])).toEqual(['npm test'])
    expect(mergeCheck(['npm test'], all(['github']), [healthy, down])).toEqual([])
  })

  it('asks for no check when the guard of main is off, CI or not', () => {
    expect(mergeCheck(['npm test'], unguarded([]), [])).toEqual([])
    expect(mergeCheck(['npm test'], unguarded(['github', 'forgejo']), [healthy, down])).toEqual([])
  })
})
