import { describe, expect, it } from 'vitest'
import type { CiKind, CiRun, CiView } from '../ci/model.js'
import type { Git } from '../git/types.js'
import type { CiSettings } from '../state.js'
import { mainCheckDeps, type MainCiWatch } from './mainci.js'

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

function setup(settings: CiSettings, views: CiView[]) {
  const gitCalls: string[][] = []
  const git: Git = async (_cwd, args) => {
    gitCalls.push(args)
    if (args[0] === 'rev-parse') return { code: 0, out: 'c2\n' }
    return { code: 0, out: 'c2abc [ABC-2] Second\nc1abc [ABC-1] First\n' }
  }
  const watches: MainCiWatch[] = views.map((each) => ({ view: each, failed: async (failed) => ({ kind: each.kind, run: failed, jobs: [], log: 'FAIL' }) }))
  const deps = mainCheckDeps({
    repo: () => 'D:/repos/abc',
    git,
    watches: () => watches,
    settings: () => settings,
    language: () => 'en',
    create: async () => 'ABC-9',
    comment: async () => {},
    prepare: async () => {},
    now: () => new Date('2026-10-12T10:05:00Z'),
  })
  return { deps, gitCalls }
}

describe('mainCheckDeps', () => {
  it('reads main of the project checkout', async () => {
    const { deps } = setup({ kinds: ['forgejo', 'github'], waitMinutes: null }, [])
    expect(await deps.head('ABC')).toBe('c2')
  })

  it('counts only the CIs the project settings name', () => {
    const views = [view('forgejo', 'failure'), view('github', 'success')]
    expect(setup({ kinds: ['github'], waitMinutes: null }, views).deps.verdict('ABC', 'c2', '2026-10-12T10:00:00Z')).toEqual({ state: 'green' })
    expect(setup({ kinds: ['forgejo', 'github'], waitMinutes: null }, views).deps.verdict('ABC', 'c2', '2026-10-12T10:00:00Z').state).toBe('red')
    expect(setup({ kinds: [], waitMinutes: null }, views).deps.verdict('ABC', 'c2', '2026-10-12T10:00:00Z')).toEqual({ state: 'none' })
  })

  it('turns the wait into milliseconds, null staying as long as it takes', () => {
    expect(setup({ kinds: [], waitMinutes: null }, []).deps.waitMs('ABC')).toBeNull()
    expect(setup({ kinds: [], waitMinutes: 0 }, []).deps.waitMs('ABC')).toBe(0)
    expect(setup({ kinds: [], waitMinutes: 15 }, []).deps.waitMs('ABC')).toBe(900_000)
  })

  it('reports the failed runs with the commits since the last green one', async () => {
    const { deps, gitCalls } = setup({ kinds: ['github'], waitMinutes: null }, [view('github', 'failure')])
    const push = { commit: 'c2', at: '2026-10-12T10:00:00Z', tasks: ['ABC-1', 'ABC-2'] }
    const report = await deps.report('ABC', push, [{ kind: 'github', run: run('github', 'failure') }], 'c0')
    expect(gitCalls.at(-1)).toEqual(['log', '--format=%h %s', '-50', 'c0..c2'])
    expect(report.title).toBe('CI on main failed: c2')
    expect(report.description).toContain('c1abc [ABC-1] First')
    expect(report.description).toContain('```text\nFAIL\n```')
  })

  it('takes the latest commits of main when no green one is known', async () => {
    const { deps, gitCalls } = setup({ kinds: ['github'], waitMinutes: null }, [view('github', 'failure')])
    await deps.report('ABC', { commit: 'c2', at: '2026-10-12T10:00:00Z', tasks: [] }, [{ kind: 'github', run: run('github', 'failure') }], null)
    expect(gitCalls.at(-1)).toEqual(['log', '--format=%h %s', '-20', 'c2'])
  })
})
