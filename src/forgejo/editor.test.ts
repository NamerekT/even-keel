import { describe, expect, it } from 'vitest'
import { RepoMap } from '../github/model.js'
import { revisionOf } from '../tracker/editor.js'
import { forgejoEditor } from './editor.js'
import { issue, milestone } from './fixture.js'
import type { ForgejoIssue } from './model.js'

const BASE = '/repos/example-org/app/issues'

function fixture(dependencies: 'on' | 'off' = 'on') {
  const recent = { issues: [] as unknown[], error: null as Error | null }
  const reads: string[] = []
  const issues: Record<number, ForgejoIssue> = {
    1: issue({ number: 1, body: 'Old text' }),
    2: issue({ number: 2, state: 'closed', labels: [], milestone: null }),
    3: issue({ number: 3 }),
    10: issue({ number: 10 }),
  }
  const blockers: Record<number, ForgejoIssue[]> = { 1: [issues[3]!] }
  const writes: [string, string, unknown][] = []
  const relabels: [string, unknown][] = []
  const uploads: [string, string][] = []
  const rest = async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
    if (method === 'GET' && path.includes('?')) {
      reads.push(path)
      if (recent.error !== null) throw recent.error
      return recent.issues as T
    }
    if (method !== 'GET') {
      writes.push([method, path, body])
      const description = (body as { body?: string } | undefined)?.body
      if (description !== undefined && (path === BASE || path === `${BASE}/10`)) issues[10]!.body = description
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
    upload: async (path, file) => void uploads.push([path, file.name]),
  })
  return { editor, writes, relabels, uploads, recent, reads }
}

describe('forgejoEditor', () => {
  it('creates a retry marker in the description, including an empty one', async () => {
    const { editor, writes } = fixture()
    const marker = editor.markers!.make()
    expect(marker).not.toBe(editor.markers!.make())
    const draft = { title: 'New', description: 'Text', status: null, priority: null, milestone: null, labels: [], parent: null }
    await editor.create('P1', draft, [], marker)
    await editor.create('P1', { ...draft, description: '' }, [], marker)
    expect(writes.map((each) => each[2])).toEqual([{ title: 'New', body: `Text\n\n<!-- even-keel:${marker} -->` }, { title: 'New', body: `<!-- even-keel:${marker} -->` }])
    const comment = `<!-- even-keel:${marker} -->`
    expect(await editor.revision('APP-10')).toBe(revisionOf(comment))
    await editor.patch('APP-10', [], 'Section')
    expect(writes.at(-1)![2]).toEqual({ body: `${comment}\n\nSection` })
    await editor.describe('APP-10', 'Replacement', revisionOf(`${comment}\n\nSection`))
    expect(writes.at(-1)![2]).toEqual({ body: 'Replacement' })
  })

  it('finds exact markers on the newest issue page, excludes PRs and propagates failures', async () => {
    const { editor, recent, reads } = fixture()
    const marker = editor.markers!.make()
    recent.issues = [{ number: 9, body: `<!-- even-keel:${marker} -->`, pull_request: {} }, { number: 8, body: null }, { number: 7, body: `<!-- even-keel:${marker}x -->` }]
    expect(await editor.markers!.find('P1', marker)).toBeNull()
    recent.issues.push({ number: 6, body: `Text\n\n<!-- even-keel:${marker} -->` })
    expect(await editor.markers!.find('P1', marker, 7)).toBe('APP-6')
    expect(reads).toEqual([`${BASE}?state=all&type=issues&sort=latest&limit=25`, `${BASE}?state=all&type=issues&sort=latest&limit=7`])
    recent.issues = []
    expect(await editor.markers!.find('P1', marker)).toBeNull()
    recent.error = new Error('offline')
    await expect(editor.markers!.find('P1', marker)).rejects.toThrow('offline')
    await expect(editor.markers!.find('missing', marker)).rejects.toThrow(/no Forgejo repository/)
  })

  it('uploads files as assets of the issue, and of a comment after posting it (BTN-895)', async () => {
    const { editor, uploads } = fixture()
    const file = { name: 'shot.png', type: 'image/png', bytes: new Uint8Array([1]) }
    await editor.files!.attach('APP-1', [file, { ...file, name: 'a.log' }])
    expect(await editor.files!.comment('APP-1', 'Look.', [file], null)).toBe('5')
    expect(uploads).toEqual([
      [`${BASE}/1/assets`, 'shot.png'],
      [`${BASE}/1/assets`, 'a.log'],
      [`${BASE}/comments/5/assets`, 'shot.png'],
    ])
    expect(editor.components).toBeUndefined()
  })

  it('keeps a priority only where the repository has a priority label', () => {
    const { editor } = fixture()
    expect(editor.priorities!(['bug', 'priority/urgent'])).toBe(true)
    expect(editor.priorities!(['bug', 'priority/none'])).toBe(false)
  })

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
