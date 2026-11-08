import { describe, expect, it } from 'vitest'
import { RepoMap } from '../github/model.js'
import { revisionOf } from '../tracker/editor.js'
import { forgejoEditor } from './editor.js'
import { issue, milestone } from './fixture.js'
import type { ForgejoIssue } from './model.js'

const BASE = '/repos/example-org/app/issues'

function fixture(dependencies: 'on' | 'off' = 'on') {
  const issues: Record<number, ForgejoIssue> = {
    1: issue({ number: 1, body: 'Old text' }),
    2: issue({ number: 2, state: 'closed', labels: [], milestone: null }),
    3: issue({ number: 3 }),
    10: issue({ number: 10 }),
  }
  const blockers: Record<number, ForgejoIssue[]> = { 1: [issues[3]!] }
  const writes: [string, string, unknown][] = []
  const relabels: [string, unknown][] = []
  const rest = async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
    if (method !== 'GET') {
      writes.push([method, path, body])
      return { number: 10 } as T
    }
    return issues[Number(/\/issues\/(\d+)$/.exec(path)![1])] as T
  }
  const editor = forgejoEditor({
    rest,
    repos: new RepoMap({ P1: { key: 'APP', value: 'example-org/app' } }),
    list: async () => [],
    labelsOf: async () => [{ id: 4, name: 'bug' }, { id: 5, name: 'priority/medium' }, { id: 6, name: 'priority/high' }],
    milestonesOf: async () => [milestone(), milestone({ id: 21, title: 'v2.0' })],
    blockersOf: async (_repo, number) => dependencies === 'off' ? null : blockers[number] ?? [],
    relabel: async (id, change) => {
      relabels.push([id, change])
      return []
    },
    comment: async () => '5',
  })
  return { editor, writes, relabels }
}

describe('forgejoEditor', () => {
  it('creates an issue with every field it can hold, then closes it', async () => {
    const { editor, writes, relabels } = fixture()
    expect(await editor.create('P1', { title: 'New', description: 'Text', status: 'closed', priority: 'high', milestone: 'V2.0', labels: ['bug'], parent: null })).toBe('APP-10')
    expect(writes).toEqual([
      ['POST', '/repos/example-org/app/issues', { title: 'New', body: 'Text', milestone: 21 }],
      ['PATCH', `${BASE}/10`, { state: 'closed' }],
    ])
    expect(relabels).toEqual([['APP-10', { add: ['bug', 'priority/high'], remove: [] }]])
  })

  it('refuses a parent, a priority without a label and an unknown status before creating anything', async () => {
    const { editor, writes } = fixture()
    const draft = { title: 'New', description: '', status: null, priority: null, milestone: null, labels: [], parent: null }
    await expect(editor.create('P1', { ...draft, parent: 'APP-1' })).rejects.toThrow(/no subtasks/)
    await expect(editor.create('P1', { ...draft, priority: 'urgent' })).rejects.toThrow(/label such as "priority\/urgent", and example-org\/app has none/)
    await expect(editor.create('P1', { ...draft, status: 'Review' })).rejects.toThrow(/statuses are Open, Closed/)
    expect(writes).toEqual([])
  })

  it('sets fields and skips the ones that hold the value already', async () => {
    const { editor, writes, relabels } = fixture()
    expect(await editor.set('APP-1', { field: 'status', to: 'open' })).toBe(false)
    expect(await editor.set('APP-2', { field: 'status', to: 'Open' })).toBe(true)
    expect(await editor.set('APP-1', { field: 'milestone', to: 'v1.0' })).toBe(false)
    expect(await editor.set('APP-1', { field: 'milestone', to: null })).toBe(true)
    expect(await editor.set('APP-2', { field: 'milestone', to: 'v2.0' })).toBe(true)
    expect(await editor.set('APP-1', { field: 'priority', to: 'medium' })).toBe(false)
    expect(await editor.set('APP-1', { field: 'priority', to: 'high' })).toBe(true)
    expect(await editor.set('APP-1', { field: 'parent', to: null })).toBe(false)
    expect(await editor.set('APP-1', { field: 'title', to: 'Renamed' })).toBe(true)
    await expect(editor.set('APP-1', { field: 'parent', to: 'APP-3' })).rejects.toThrow(/no subtasks/)
    expect(writes).toEqual([
      ['PATCH', `${BASE}/2`, { state: 'open' }],
      ['PATCH', `${BASE}/1`, { milestone: 0 }],
      ['PATCH', `${BASE}/2`, { milestone: 21 }],
      ['PATCH', `${BASE}/1`, { title: 'Renamed' }],
    ])
    expect(relabels).toEqual([['APP-1', { add: ['priority/high'], remove: ['priority/medium'] }]])
  })

  it('links through the blocked issue\'s dependencies and refuses "relates"', async () => {
    const { editor, writes } = fixture()
    await editor.link('APP-1', 'APP-3', 'blockedBy', true)
    await editor.link('APP-1', 'APP-3', 'blockedBy', false)
    await editor.link('APP-1', 'APP-10', 'blocks', true)
    await expect(editor.link('APP-1', 'APP-10', 'relates', true)).rejects.toThrow(/no "relates" link/)
    expect(writes).toEqual([
      ['DELETE', `${BASE}/1/dependencies`, { owner: 'example-org', repo: 'app', index: 3 }],
      ['POST', `${BASE}/10/dependencies`, { owner: 'example-org', repo: 'app', index: 1 }],
    ])
  })

  it('refuses a link where the repository has dependencies turned off', async () => {
    const { editor } = fixture('off')
    await expect(editor.link('APP-1', 'APP-3', 'blocks', true)).rejects.toThrow(/dependencies turned off/)
  })

  it('revises and patches the description as a hash of its text', async () => {
    const { editor, writes } = fixture()
    expect(await editor.revision('APP-1')).toBe(revisionOf('Old text'))
    expect(await editor.patch('APP-1', [{ old: 'Old', new: 'New' }], null)).toBe(true)
    expect(writes).toEqual([['PATCH', `${BASE}/1`, { body: 'New text' }]])
  })
})
