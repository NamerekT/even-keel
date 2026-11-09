import { describe, expect, it } from 'vitest'
import { revisionOf } from '../tracker/editor.js'
import type { LabelChange } from '../tracker/labels.js'
import { githubEditor } from './editor.js'
import { RepoMap } from './model.js'

const REPO = { nameWithOwner: 'octo-org/abc' }

function fixture() {
  const recent = { issues: [] as unknown[], error: null as Error | null }
  const reads: string[] = []
  const issue = (number: number, more: Record<string, unknown> = {}) => ({
    id: `I${number}`, number, repository: REPO, title: `Issue ${number}`, body: '', state: 'OPEN', stateReason: null,
    milestone: null, parent: null, labels: { nodes: [] as { name: string }[] }, blockedBy: { nodes: [] as unknown[] }, ...more,
  })
  const issues = new Map<number, ReturnType<typeof issue>>([
    [1, issue(1, { body: 'Old text', labels: { nodes: [{ name: 'priority: low' }, { name: 'bug' }] }, milestone: { id: 'M1', title: 'v1' } })],
    [2, issue(2, { state: 'CLOSED', stateReason: 'COMPLETED', parent: { id: 'I1', number: 1, repository: REPO } })],
    [3, issue(3, { blockedBy: { nodes: [{ id: 'I1', number: 1, repository: REPO }] } })],
  ])
  const mutations: [string, Record<string, unknown>][] = []
  const relabels: [string, LabelChange][] = []
  const graphql = async <T>(query: string, variables: Record<string, unknown> = {}): Promise<T> => {
    const name = /mutation[^{]*\{\s*(\w+)/.exec(query)?.[1]
    if (name !== undefined) {
      mutations.push([name, variables])
      if (name === 'createIssue') issues.set(10, issue(10, { body: (variables.input as { body: string }).body }))
      if (name === 'updateIssue') {
        const input = variables.input as { id: string; body?: string }
        if (input.body !== undefined) issues.get(Number(input.id.slice(1)))!.body = input.body
      }
      return { createIssue: { issue: { number: 10 } } } as T
    }
    if (query.includes('query: "priority"')) {
      return {
        repository: { id: 'R1', milestones: { nodes: [{ id: 'M1', title: 'v1' }, { id: 'M2', title: 'v2' }] }, labels: { nodes: [{ name: 'priority: high' }, { name: 'Priority/Low' }] } },
      } as T
    }
    return { repository: { issue: issues.get(variables.number as number) ?? null } } as T
  }
  const editor = githubEditor({
    graphql,
    rest: async <T>(path: string): Promise<T> => {
      reads.push(path)
      if (recent.error !== null) throw recent.error
      return recent.issues as T
    },
    repos: new RepoMap({ P1: { key: 'ABC', value: 'octo-org/abc' } }),
    list: async () => [],
    relabel: async (id, change) => {
      relabels.push([id, change])
      return []
    },
    comment: async () => 'C1',
  })
  return { editor, mutations, relabels, recent, reads }
}

describe('githubEditor', () => {
  it('creates a hidden retry marker, counts it in revisions and preserves it on patches', async () => {
    const { editor, mutations } = fixture()
    const marker = editor.markers!.make()
    expect(marker).not.toBe(editor.markers!.make())
    const comment = `<!-- even-keel:${marker} -->`
    const draft = { title: 'New', description: 'Text', status: null, priority: null, milestone: null, labels: [], parent: null }
    await editor.create('P1', draft, [], marker)
    expect(mutations[0]![1]).toMatchObject({ input: { body: `Text\n\n${comment}` } })
    expect(await editor.revision('ABC-10')).toBe(revisionOf(`Text\n\n${comment}`))
    await editor.patch('ABC-10', [{ old: 'Text', new: 'Edited' }], null)
    expect(mutations.at(-1)![1]).toMatchObject({ input: { body: `Edited\n\n${comment}` } })
    await editor.describe('ABC-10', 'Replacement', revisionOf(`Edited\n\n${comment}`))
    expect(mutations.at(-1)![1]).toMatchObject({ input: { body: 'Replacement' } })
    await editor.create('P1', { ...draft, description: '' }, [], marker)
    expect(mutations.at(-1)![1]).toMatchObject({ input: { body: comment } })
  })

  it('finds exact markers on the newest issue page, excludes PRs and propagates failures', async () => {
    const { editor, recent, reads } = fixture()
    const marker = editor.markers!.make()
    recent.issues = [{ number: 9, body: `<!-- even-keel:${marker} -->`, pull_request: {} }, { number: 8, body: null }, { number: 7, body: `<!-- even-keel:${marker}x -->` }]
    expect(await editor.markers!.find('P1', marker)).toBeNull()
    recent.issues.push({ number: 6, body: `Text\n\n<!-- even-keel:${marker} -->` })
    expect(await editor.markers!.find('P1', marker, 7)).toBe('ABC-6')
    expect(reads).toEqual(['/repos/octo-org/abc/issues?state=all&sort=created&direction=desc&per_page=25', '/repos/octo-org/abc/issues?state=all&sort=created&direction=desc&per_page=7'])
    recent.issues = []
    expect(await editor.markers!.find('P1', marker)).toBeNull()
    recent.error = new Error('offline')
    await expect(editor.markers!.find('P1', marker)).rejects.toThrow('offline')
    await expect(editor.markers!.find('missing', marker)).rejects.toThrow(/no GitHub repository/)
  })

  it('keeps a priority only where the repository has a priority label, and no estimate', () => {
    const { editor } = fixture()
    expect(editor.priorities!(['bug', 'Priority: High'])).toBe(true)
    expect(editor.priorities!(['bug', 'priority-high'])).toBe(false)
    expect(editor.estimate).toBeUndefined()
  })

  it('creates an issue with every field: milestone, parent, labels with the priority label, then the closed status', async () => {
    const { editor, mutations, relabels } = fixture()
    const id = await editor.create('P1', { title: 'New', description: 'Text', status: 'Not planned', priority: 'high', milestone: 'V2', labels: ['bug'], parent: 'ABC-1' })
    expect(id).toBe('ABC-10')
    expect(mutations).toEqual([
      ['createIssue', { input: { repositoryId: 'R1', title: 'New', body: 'Text', milestoneId: 'M2', parentIssueId: 'I1' } }],
      ['closeIssue', { id: 'I10', reason: 'NOT_PLANNED' }],
    ])
    expect(relabels).toEqual([['ABC-10', { add: ['bug', 'priority: high'], remove: [] }]])
  })

  it('refuses a priority the repository has no label for, before creating anything', async () => {
    const { editor, mutations } = fixture()
    await expect(editor.create('P1', { title: 'New', description: '', status: null, priority: 'urgent', milestone: null, labels: [], parent: null })).rejects.toThrow(
      /label "priority: urgent".*has none/,
    )
    expect(mutations).toEqual([])
  })

  it('sets a status by the state and its close reason, reopening a closed issue first', async () => {
    const { editor, mutations } = fixture()
    expect(await editor.set('ABC-1', { field: 'status', to: 'Open' })).toBe(false)
    expect(await editor.set('ABC-2', { field: 'status', to: 'Duplicate' })).toBe(true)
    expect(await editor.set('ABC-2', { field: 'status', to: 'Open' })).toBe(true)
    expect(mutations).toEqual([
      ['reopenIssue', { id: 'I2' }],
      ['closeIssue', { id: 'I2', reason: 'DUPLICATE' }],
      ['reopenIssue', { id: 'I2' }],
    ])
  })

  it('swaps the priority labels for the one of the new level', async () => {
    const { editor, relabels } = fixture()
    expect(await editor.set('ABC-1', { field: 'priority', to: 'low' })).toBe(false)
    expect(await editor.set('ABC-1', { field: 'priority', to: 'high' })).toBe(true)
    expect(await editor.set('ABC-1', { field: 'priority', to: 'none' })).toBe(true)
    expect(relabels).toEqual([
      ['ABC-1', { add: ['priority: high'], remove: ['priority: low'] }],
      ['ABC-1', { add: [], remove: ['priority: low'] }],
    ])
  })

  it('sets the title, the milestone by its title and the parent as a sub-issue', async () => {
    const { editor, mutations } = fixture()
    expect(await editor.set('ABC-1', { field: 'title', to: 'Issue 1' })).toBe(false)
    expect(await editor.set('ABC-1', { field: 'milestone', to: 'v1' })).toBe(false)
    expect(await editor.set('ABC-1', { field: 'milestone', to: 'v2' })).toBe(true)
    expect(await editor.set('ABC-1', { field: 'milestone', to: null })).toBe(true)
    await expect(editor.set('ABC-1', { field: 'milestone', to: 'v9' })).rejects.toThrow(/no milestone "v9"/)
    expect(await editor.set('ABC-2', { field: 'parent', to: 'abc-1' })).toBe(false)
    expect(await editor.set('ABC-2', { field: 'parent', to: 'ABC-3' })).toBe(true)
    expect(await editor.set('ABC-2', { field: 'parent', to: null })).toBe(true)
    await expect(editor.set('ABC-3', { field: 'parent', to: 'ABC-3' })).rejects.toThrow(/its own parent/)
    expect(mutations).toEqual([
      ['updateIssue', { input: { id: 'I1', milestoneId: 'M2' } }],
      ['updateIssue', { input: { id: 'I1', milestoneId: null } }],
      ['addSubIssue', { parent: 'I3', child: 'I2' }],
      ['removeSubIssue', { parent: 'I1', child: 'I2' }],
    ])
  })

  it('links by "blocked by" on the blocked issue, skips a link there already and refuses "relates"', async () => {
    const { editor, mutations } = fixture()
    await editor.link('ABC-1', 'ABC-3', 'blocks', true)
    await editor.link('ABC-3', 'ABC-1', 'blockedBy', false)
    await editor.link('ABC-2', 'ABC-1', 'blocks', true)
    await editor.link('ABC-2', 'ABC-1', 'blockedBy', false)
    await expect(editor.link('ABC-1', 'ABC-2', 'relates', true)).rejects.toThrow(/no "relates"/)
    await expect(editor.link('ABC-1', 'ABC-1', 'blocks', true)).rejects.toThrow(/to itself/)
    await expect(editor.link('XYZ-1', 'ABC-1', 'blocks', true)).rejects.toThrow(/not a task of a GitHub project/)
    expect(mutations).toEqual([
      ['removeBlockedBy', { issue: 'I3', blocker: 'I1' }],
      ['addBlockedBy', { issue: 'I1', blocker: 'I2' }],
    ])
  })

  it('writes the body by the hash revision and by patches', async () => {
    const { editor, mutations } = fixture()
    expect(await editor.revision('ABC-1')).toBe(revisionOf('Old text'))
    await expect(editor.describe('ABC-1', 'New', revisionOf('x'))).rejects.toThrow(/changed since rev/)
    expect(await editor.describe('ABC-1', 'New', revisionOf('Old text'))).toBe(true)
    expect(await editor.patch('ABC-1', [{ old: 'New', new: 'Older text' }], null)).toBe(true)
    expect(mutations).toEqual([
      ['updateIssue', { input: { id: 'I1', body: 'New' } }],
      ['updateIssue', { input: { id: 'I1', body: 'Older text' } }],
    ])
  })
})
