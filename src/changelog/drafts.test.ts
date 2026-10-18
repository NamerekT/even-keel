import { describe, expect, it, vi } from 'vitest'
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

function setup(tasks: MilestoneTask[] = [task('ABC-1'), task('ABC-2', 'ToDo')]) {
  let written = 0
  const deps: ChangelogDeps = {
    tasks: vi.fn(async () => tasks),
    write: vi.fn(async () => `## [v0.1] #${++written}`),
    now: () => new Date('2026-10-18T10:00:00Z'),
  }
  return { deps, drafts: new ChangelogDrafts(deps) }
}

describe('ChangelogDrafts', () => {
  it('writes a draft from the done tasks and counts the open ones', async () => {
    const { deps, drafts } = setup()
    const draft = await drafts.draft('ABC', 'v0.1')
    expect(draft).toEqual({ project: 'ABC', milestone: 'v0.1', text: '## [v0.1] #1', done: 1, open: 1, at: '2026-10-18T10:00:00.000Z' })
    expect(deps.write).toHaveBeenCalledWith('ABC', expect.stringContaining('### ABC-1 · ABC-1'))
  })

  it('gives the last draft again, and writes anew only when asked', async () => {
    const { deps, drafts } = setup()
    await drafts.draft('ABC', 'v0.1')
    expect((await drafts.draft('ABC', 'v0.1')).text).toBe('## [v0.1] #1')
    expect((await drafts.draft('ABC', 'v0.1', true)).text).toBe('## [v0.1] #2')
    expect(deps.write).toHaveBeenCalledTimes(2)
  })

  it('joins a draft being written instead of starting a second one', async () => {
    const { deps, drafts } = setup()
    const [a, b] = await Promise.all([drafts.draft('ABC', 'v0.1'), drafts.draft('ABC', 'v0.1', true)])
    expect(a).toBe(b)
    expect(deps.write).toHaveBeenCalledTimes(1)
  })

  it('refuses a milestone with no done task without calling the agent', async () => {
    const { deps, drafts } = setup([task('ABC-2', 'ToDo')])
    await expect(drafts.draft('ABC', 'v0.1')).rejects.toMatchObject({ notice: { code: 'changelog.empty', params: { milestone: 'v0.1' } } })
    expect(deps.write).not.toHaveBeenCalled()
  })

  it('keeps no failed draft: the next call tries again', async () => {
    const { deps, drafts } = setup()
    vi.mocked(deps.write).mockRejectedValueOnce(new Error('agent down'))
    await expect(drafts.draft('ABC', 'v0.1')).rejects.toThrow('agent down')
    expect((await drafts.draft('ABC', 'v0.1')).text).toBe('## [v0.1] #1')
  })

  it('keeps drafts apart by project and milestone', async () => {
    const { drafts } = setup()
    await drafts.draft('ABC', 'v0.1')
    expect((await drafts.draft('ABC', 'v0.2')).text).toBe('## [v0.1] #2')
  })
})
