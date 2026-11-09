import { describe, expect, it } from 'vitest'
import { revisionOf, type TaskUpload } from '../tracker/editor.js'
import type { LabelChange } from '../tracker/labels.js'
import { linearEditor } from './editor.js'

const STATES = [
  { id: 's-todo', name: 'Todo', type: 'unstarted' },
  { id: 's-backlog', name: 'Backlog', type: 'backlog' },
  { id: 's-done', name: 'Done', type: 'completed' },
]

function fixture() {
  const issue = (number: number, more: Record<string, unknown> = {}) => ({
    id: `u${number}`, identifier: `ENG-${number}`, title: `Issue ${number}`, description: null, priority: 0, state: { id: 's-todo' },
    parent: null, project: null, projectMilestone: null, team: { id: 'team', key: 'ENG', states: { nodes: STATES } }, relations: { nodes: [] as unknown[] }, ...more,
  })
  const issues = new Map([
    [1, issue(1, { description: 'Old text', priority: 3, project: { id: 'p-web' }, projectMilestone: { id: 'm-1', name: 'Beta' } })],
    [2, issue(2, { parent: { id: 'u1', identifier: 'ENG-1' }, relations: { nodes: [{ id: 'r-1', type: 'blocks', relatedIssue: { id: 'u3' } }] } })],
    [3, issue(3, { relations: { nodes: [{ id: 'r-2', type: 'related', relatedIssue: { id: 'u1' } }] } })],
  ])
  const mutations: [string, Record<string, unknown>][] = []
  const relabels: [string, LabelChange][] = []
  const uploads: TaskUpload[] = []
  const comments: [string, string][] = []
  const graphql = async <T>(query: string, variables: Record<string, unknown> = {}): Promise<T> => {
    const name = /mutation[^{]*\{\s*(\w+)/.exec(query)?.[1]
    if (name !== undefined) {
      mutations.push([name, variables])
      return { [name]: { success: true, issue: { identifier: 'ENG-10' } } } as T
    }
    if (query.includes('projectMilestones')) {
      const milestones = (id: string, names: string[]) => ({ id, projectMilestones: { nodes: names.map((each) => ({ id: `m-${id}-${each}`, name: each })) } })
      return { team: { projects: { nodes: [milestones('p-web', ['Beta', 'GA']), milestones('p-api', ['GA', 'Alpha'])] } } } as T
    }
    const filter = variables.filter as { id?: { eq: string }; team: { id?: { eq: string } }; number: { eq: number } }
    if (filter.id !== undefined) {
      const found = [...issues.values()].find((each) => each.id === filter.id!.eq && each.team.id === filter.team.id?.eq)
      return { issues: { nodes: found === undefined ? [] : [{ identifier: found.identifier }] } } as T
    }
    const number = filter.number.eq
    return { issues: { nodes: issues.has(number) ? [issues.get(number)] : [] } } as T
  }
  const editor = linearEditor({
    graphql,
    teamOf: async () => ({ id: 'team', states: STATES }),
    list: async () => [],
    relabel: async (id, change) => {
      relabels.push([id, change])
      return []
    },
    comment: async (id, body) => {
      comments.push([id, body])
      return 'c-1'
    },
    upload: async (file) => {
      uploads.push(file)
      return `https://uploads.linear.app/asset/${file.name}`
    },
  })
  return { editor, mutations, relabels, uploads, comments }
}

const FILES: TaskUpload[] = [
  { name: 'shot.png', type: 'image/png', bytes: new Uint8Array([1, 2]) },
  { name: 'log.txt', type: 'text/plain', bytes: new Uint8Array([3]) },
]

describe('linearEditor', () => {
  it('creates an issue in the backlog by default, under its parent, with labels after', async () => {
    const { editor, mutations, relabels } = fixture()
    expect(await editor.create('P1', { title: 'New', description: 'Text', status: null, priority: 'high', milestone: null, labels: ['Bug'], parent: 'ENG-1' })).toBe('ENG-10')
    expect(mutations).toEqual([
      ['issueCreate', { input: { teamId: 'team', title: 'New', description: 'Text', priority: 2, stateId: 's-backlog', projectId: 'p-web', parentId: 'u1' } }],
    ])
    expect(relabels).toEqual([['ENG-10', { add: ['Bug'], remove: [] }]])
  })

  it('a marker is the new issue\'s own UUID, looked up in the team', async () => {
    const { editor, mutations } = fixture()
    const marker = editor.markers!.make()
    expect(marker).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    await editor.create('P1', { title: 'New', description: '', status: null, priority: null, milestone: null, labels: [], parent: null }, [], marker)
    expect(mutations[0]![1]).toMatchObject({ input: { id: marker, title: 'New' } })
    expect(await editor.markers!.find('P1', 'u2')).toBe('ENG-2')
    expect(await editor.markers!.find('P1', marker)).toBeNull()
  })

  it('puts a new issue into the project of its milestone, and refuses a name two projects share', async () => {
    const { editor, mutations } = fixture()
    await editor.create('P1', { title: 'New', description: '', status: 'done', priority: null, milestone: 'alpha', labels: [], parent: null })
    expect(mutations[0]![1]).toMatchObject({ input: { stateId: 's-done', priority: 0, projectId: 'p-api', projectMilestoneId: 'm-p-api-Alpha' } })
    await expect(editor.create('P1', { title: 'New', description: '', status: null, priority: null, milestone: 'GA', labels: [], parent: null })).rejects.toThrow(/several Linear projects/)
  })

  it('sets the native fields and skips one that holds the value', async () => {
    const { editor, mutations } = fixture()
    expect(await editor.set('ENG-1', { field: 'status', to: 'todo' })).toBe(false)
    expect(await editor.set('ENG-1', { field: 'status', to: 'Done' })).toBe(true)
    expect(await editor.set('ENG-1', { field: 'priority', to: 'medium' })).toBe(false)
    expect(await editor.set('ENG-1', { field: 'priority', to: 'urgent' })).toBe(true)
    expect(await editor.set('ENG-1', { field: 'milestone', to: 'beta' })).toBe(false)
    expect(await editor.set('ENG-1', { field: 'milestone', to: 'GA' })).toBe(true)
    expect(await editor.set('ENG-3', { field: 'milestone', to: 'Alpha' })).toBe(true)
    expect(await editor.set('ENG-1', { field: 'milestone', to: null })).toBe(true)
    expect(await editor.set('ENG-2', { field: 'parent', to: 'eng-1' })).toBe(false)
    expect(await editor.set('ENG-2', { field: 'parent', to: null })).toBe(true)
    expect(await editor.set('ENG-3', { field: 'parent', to: 'ENG-1' })).toBe(true)
    await expect(editor.set('ENG-1', { field: 'status', to: 'Gone' })).rejects.toThrow(/no status "Gone"/)
    expect(mutations.map(([, variables]) => variables)).toEqual([
      { id: 'u1', input: { stateId: 's-done' } },
      { id: 'u1', input: { priority: 1 } },
      { id: 'u1', input: { projectMilestoneId: 'm-p-web-GA' } },
      { id: 'u3', input: { projectId: 'p-api', projectMilestoneId: 'm-p-api-Alpha' } },
      { id: 'u1', input: { projectMilestoneId: null } },
      { id: 'u2', input: { parentId: null } },
      { id: 'u3', input: { parentId: 'u1' } },
    ])
  })

  it('links by relations on the blocker, in either direction for "relates"', async () => {
    const { editor, mutations } = fixture()
    await editor.link('ENG-3', 'ENG-2', 'blockedBy', true)
    await editor.link('ENG-2', 'ENG-3', 'blocks', false)
    await editor.link('ENG-1', 'ENG-3', 'relates', true)
    await editor.link('ENG-1', 'ENG-3', 'relates', false)
    await editor.link('ENG-1', 'ENG-2', 'blockedBy', true)
    await expect(editor.link('ENG-1', 'ENG-1', 'relates', true)).rejects.toThrow(/to itself/)
    expect(mutations).toEqual([
      ['issueRelationDelete', { id: 'r-1' }],
      ['issueRelationDelete', { id: 'r-2' }],
      ['issueRelationCreate', { input: { issueId: 'u2', relatedIssueId: 'u1', type: 'blocks' } }],
    ])
  })

  it('writes the description by the hash revision', async () => {
    const { editor, mutations } = fixture()
    expect(await editor.revision('ENG-1')).toBe(revisionOf('Old text'))
    expect(await editor.patch('ENG-1', [{ old: 'Old', new: 'New' }], null)).toBe(true)
    expect(mutations).toEqual([['issueUpdate', { id: 'u1', input: { description: 'New text' } }]])
  })

  it('attaches uploaded files to the issue, one attachment each', async () => {
    const { editor, mutations, uploads } = fixture()
    await editor.files!.attach('ENG-1', FILES)
    expect(uploads.map((each) => each.name)).toEqual(['shot.png', 'log.txt'])
    expect(mutations).toEqual([
      ['attachmentCreate', { input: { issueId: 'u1', url: 'https://uploads.linear.app/asset/shot.png', title: 'shot.png' } }],
      ['attachmentCreate', { input: { issueId: 'u1', url: 'https://uploads.linear.app/asset/log.txt', title: 'log.txt' } }],
    ])
    await expect(editor.files!.attach('ENG-9', FILES)).rejects.toThrow(/not found/)
  })

  it('posts a comment with the links of its uploaded files', async () => {
    const { editor, comments } = fixture()
    expect(await editor.files!.comment('ENG-1', 'Done.', FILES, null)).toBe('c-1')
    expect(comments).toEqual([['ENG-1', 'Done.\n\n![shot.png](https://uploads.linear.app/asset/shot.png)\n[log.txt](https://uploads.linear.app/asset/log.txt)']])
  })
})
