import type { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChangelogSpend } from '../state.js'
import { openDatabase } from '../storage/database.js'
import type { MilestoneTask } from '../tracker/source.js'
import { ChangelogDrafts, type ChangelogDeps } from './drafts.js'

const task = (id: string, category: 'Won' | 'ToDo' = 'Won'): MilestoneTask => ({
  id,
  title: id,
  status: { name: category, category },
  blockedBy: [],
  parent: null,
  subtasks: 0,
  milestone: { label: 'v0.1', targetDate: null },
  priority: 'none',
  labels: [],
  estimate: null,
  lastComment: null,
})

const HEAD = '# Changelog\n\nIntro\n\n'

const SPEND: ChangelogSpend = {
  account: 'work',
  model: 'claude-sonnet-5-5',
  tokens: { input: 1_000, output: 500, cacheRead: 20_000, cacheWrite: 4_000 },
  cost: 0.25,
  durationMs: 30_000,
}

describe('ChangelogDrafts', { timeout: 60_000 }, () => {
  let db: PGlite
  beforeEach(async () => {
    db = await openDatabase(undefined)
  })
  afterEach(() => db.close())

  function setup(fields: { tasks?: MilestoneTask[]; file?: string | null; tags?: string[] } = {}) {
    const state = { tasks: fields.tasks ?? [task('ABC-1'), task('ABC-2', 'ToDo')], file: fields.file ?? null, tags: fields.tags ?? [], turns: 0 }
    const deps: ChangelogDeps = {
      tasks: vi.fn(async () => state.tasks),
      write: vi.fn(async () => ({ text: `Here it is:\n\n## [Unreleased]\n\n- Change #${++state.turns}`, spend: SPEND })),
      file: async () => ({ path: 'CHANGELOG.md', text: state.file }),
      tags: async () => state.tags,
      commit: vi.fn(async (_project: string, _path: string, _message: string, change: (text: string | null) => string) => {
        const next = change(state.file)
        if (next === state.file) return null
        state.file = next
        return 'abc123'
      }),
      db,
      ids: () => ({ ABC: '11111111-1111-4111-8111-111111111111' }),
      now: () => new Date('2026-10-18T10:00:00Z'),
    }
    const drafts = new ChangelogDrafts(deps)
    const prompt = (call: number) => vi.mocked(deps.write).mock.calls[call]![1]
    return { deps, state, drafts, prompt }
  }

  it('writes the first draft from the done tasks and gives it again on the next open', async () => {
    const { deps, drafts, prompt } = setup()
    const view = await drafts.run('ABC', 'v0.1', { op: 'open' })
    expect(view).toMatchObject({ project: 'ABC', milestone: 'v0.1', file: 'CHANGELOG.md', released: null })
    expect(view.version).toMatchObject({ number: 1, kind: 'draft', text: '## [Unreleased]\n\n- Change #1', base: null, tasks: ['ABC-1'], open: 1, written: null })
    expect(prompt(0)).toContain('Write the changelog section')
    expect((await drafts.run('ABC', 'v0.1', { op: 'open' })).version.number).toBe(1)
    expect(deps.write).toHaveBeenCalledTimes(1)
  })

  it('updates the section already in the file and shows the changes against it', async () => {
    const { drafts, prompt } = setup({ file: `${HEAD}## [Unreleased]\n\n- Mine\n` })
    const view = await drafts.run('ABC', 'v0.1', { op: 'open' })
    expect(view.version.base).toBe('## [Unreleased]\n\n- Mine')
    expect(prompt(0)).toContain('Bring the changelog section')
    expect(prompt(0)).toContain('## The section now\n\n## [Unreleased]\n\n- Mine')
  })

  it('edits the newest version without the tracker, against it', async () => {
    const { deps, drafts, prompt } = setup()
    await drafts.run('ABC', 'v0.1', { op: 'open' })
    const view = await drafts.run('ABC', 'v0.1', { op: 'edit', instruction: 'Shorter' })
    expect(view.version).toMatchObject({ number: 2, kind: 'edit', base: '## [Unreleased]\n\n- Change #1', instruction: 'Shorter', tasks: ['ABC-1'] })
    expect(prompt(1)).toContain('## What the user asks\n\nShorter')
    expect(deps.tasks).toHaveBeenCalledTimes(1)
  })

  it("keeps each turn's spend with its version and gives the milestone's sum, the written version's too", async () => {
    const { drafts } = setup()
    await drafts.run('ABC', 'v0.1', { op: 'open' })
    const view = await drafts.run('ABC', 'v0.1', { op: 'edit', instruction: 'Shorter' })
    expect(view.version.spend).toEqual(SPEND)
    const sum = { turns: 2, cost: 0.5, unpriced: 0, tokens: { input: 2_000, output: 1_000, cacheRead: 40_000, cacheWrite: 8_000 } }
    expect(view.spent).toEqual(sum)
    expect((await drafts.run('ABC', 'v0.1', { op: 'write' })).spent).toEqual(sum)
  })

  it('writes the newest version into the file by a commit, once', async () => {
    const { deps, state, drafts } = setup({ file: `${HEAD}## [0.0.1]\n\n- Old\n` })
    await drafts.run('ABC', 'v0.1', { op: 'open' })
    const view = await drafts.run('ABC', 'v0.1', { op: 'write' })
    expect(view.version.written).toEqual({ at: '2026-10-18T10:00:00.000Z', commit: 'abc123' })
    expect(state.file).toBe(`${HEAD}## [Unreleased]\n\n- Change #1\n\n## [0.0.1]\n\n- Old\n`)
    expect(vi.mocked(deps.commit).mock.calls[0]?.[2]).toBe('Changelog of v0.1')
    await drafts.run('ABC', 'v0.1', { op: 'write' })
    expect(deps.commit).toHaveBeenCalledTimes(1)
    expect(drafts.writtenTasks()).toEqual({ ABC: { 'v0.1': ['ABC-1'] } })
    const again = new ChangelogDrafts(deps)
    await again.load()
    expect(again.writtenTasks()).toEqual({ ABC: { 'v0.1': ['ABC-1'] } })
  })

  it('adds only the new done tasks to the written section, from the file with the user\'s edits', async () => {
    const { state, drafts, prompt } = setup()
    await drafts.run('ABC', 'v0.1', { op: 'open' })
    await drafts.run('ABC', 'v0.1', { op: 'write' })
    state.file = state.file!.replace('- Change #1', '- Change #1, by hand')
    state.tasks = [task('ABC-1'), task('ABC-2')]
    const view = await drafts.run('ABC', 'v0.1', { op: 'add' })
    expect(view.version).toMatchObject({ kind: 'add', base: '## [Unreleased]\n\n- Change #1, by hand', tasks: ['ABC-1', 'ABC-2'], open: 0 })
    expect(prompt(1)).toContain('### ABC-2 · ABC-2')
    expect(prompt(1)).not.toContain('### ABC-1 · ABC-1')
    await expect(drafts.run('ABC', 'v0.1', { op: 'add' })).rejects.toMatchObject({ notice: { code: 'changelog.nothingNew' } })
  })

  it('puts the new tasks of a released milestone into the next patch and refuses to edit the frozen section', async () => {
    const { state, drafts, prompt } = setup()
    await drafts.run('ABC', 'v0.1', { op: 'open' })
    await drafts.run('ABC', 'v0.1', { op: 'write' })
    state.file = state.file!.replace('## [Unreleased]', '## [0.1.0] - 2026-10-21')
    state.tags = ['v0.1.0']
    await expect(drafts.run('ABC', 'v0.1', { op: 'edit', instruction: 'x' })).rejects.toMatchObject({ notice: { code: 'changelog.released', params: { tag: 'v0.1.0' } } })
    state.tasks = [task('ABC-1'), task('ABC-3')]
    const view = await drafts.run('ABC', 'v0.1', { op: 'add' })
    expect(view.released).toBe('v0.1.0')
    expect(view.version.base).toBeNull()
    expect(prompt(1)).toContain('starting with its heading `## [0.1.1]`')
    expect(prompt(1)).toContain('## Already released — leave out what this section describes\n\n## [0.1.0] - 2026-10-21')
  })

  it('writes again from all done tasks, the section in the file as the base', async () => {
    const { drafts, prompt } = setup({ file: `${HEAD}## [Unreleased]\n\n- Mine\n` })
    await drafts.run('ABC', 'v0.1', { op: 'open' })
    const view = await drafts.run('ABC', 'v0.1', { op: 'again' })
    expect(view.version).toMatchObject({ number: 2, kind: 'again', base: '## [Unreleased]\n\n- Mine' })
    expect(prompt(1)).toContain('Write the changelog section')
    expect(prompt(1)).not.toContain('## The section now')
  })

  it('joins an operation that runs instead of starting a second one', async () => {
    const { deps, drafts } = setup()
    const [a, b] = await Promise.all([drafts.run('ABC', 'v0.1', { op: 'open' }), drafts.run('ABC', 'v0.1', { op: 'again' })])
    expect(a).toBe(b)
    expect(deps.write).toHaveBeenCalledTimes(1)
  })

  it('refuses a milestone with no done task and an edit without a draft, without calling the agent', async () => {
    const { deps, drafts } = setup({ tasks: [task('ABC-2', 'ToDo')] })
    await expect(drafts.run('ABC', 'v0.1', { op: 'open' })).rejects.toMatchObject({ notice: { code: 'changelog.empty', params: { milestone: 'v0.1' } } })
    await expect(drafts.run('ABC', 'v0.1', { op: 'edit', instruction: 'x' })).rejects.toMatchObject({ notice: { code: 'changelog.noDraft' } })
    expect(deps.write).not.toHaveBeenCalled()
  })

  it('keeps no failed turn: the next call tries again', async () => {
    const { deps, drafts } = setup()
    vi.mocked(deps.write).mockRejectedValueOnce(new Error('agent down'))
    await expect(drafts.run('ABC', 'v0.1', { op: 'open' })).rejects.toThrow('agent down')
    expect((await drafts.run('ABC', 'v0.1', { op: 'open' })).version.number).toBe(1)
  })
})
