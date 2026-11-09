import { describe, expect, it } from 'vitest'
import { revisionOf } from '../tracker/editor.js'
import { markdownToAdf } from './adf.js'
import { jiraEditor } from './editor.js'
import { toCard, toTrackerTask, type JiraIssue } from './model.js'

const status = (name: string) => ({ id: name, name, statusCategory: { key: 'new' } })
const ref = (key: string) => ({ key, fields: { summary: key, status: status('To Do') } })

function fixture() {
  const recent = { issues: [] as unknown[], error: null as Error | null }
  const searches: unknown[] = []
  const issues: Record<string, JiraIssue['fields']> = {
    'ABC-1': { summary: 'Epic', status: status('To Do'), priority: { id: '3', name: 'Medium' }, fixVersions: [{ id: 'v1', name: '1.0' }], issuetype: { hierarchyLevel: 1 }, description: markdownToAdf('Old text') },
    'ABC-2': {
      summary: 'Story', status: status('To Do'), issuetype: { hierarchyLevel: 0 }, parent: ref('ABC-1'),
      issuelinks: [{ id: 'l-1', type: { name: 'Blocks' }, inwardIssue: ref('ABC-3') }, { id: 'l-2', type: { name: 'Relates' }, outwardIssue: ref('ABC-1') }],
    },
    'ABC-3': { summary: 'Sub', status: status('To Do'), issuetype: { hierarchyLevel: -1, subtask: true } },
    'ABC-10': { summary: 'New', status: status('To Do'), issuetype: { hierarchyLevel: 0 } },
  }
  const writes: [string, string, unknown][] = []
  const comments: [string, string][] = []
  const uploads: [string, string[]][] = []
  let nextLink = 3
  const rest = async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
    if (path === '/search/jql') {
      searches.push(body)
      if (recent.error !== null) throw recent.error
      return { issues: recent.issues } as T
    }
    if (method !== 'GET') {
      writes.push([method, path, body])
      if (path === '/issueLink' && method === 'POST') {
        const link = body as { type: { name: string }; inwardIssue: { key: string }; outwardIssue: { key: string } }
        const id = `l-${nextLink++}`
        // Jira returns the opposite endpoint on each issue; POST's inward issue is the blocker.
        const inward = issues[link.inwardIssue.key]!
        const outward = issues[link.outwardIssue.key]!
        inward.issuelinks = [...(inward.issuelinks ?? []), { id, type: link.type, outwardIssue: ref(link.outwardIssue.key) }]
        outward.issuelinks = [...(outward.issuelinks ?? []), { id, type: link.type, inwardIssue: ref(link.inwardIssue.key) }]
      }
      if (path.startsWith('/issueLink/') && method === 'DELETE') {
        const id = decodeURIComponent(path.slice('/issueLink/'.length))
        for (const fields of Object.values(issues)) fields.issuelinks = (fields.issuelinks ?? []).filter((each) => each.id !== id)
      }
      return { key: 'ABC-10' } as T
    }
    if (path.endsWith('/transitions')) return { transitions: [{ id: 't-31', to: { name: 'Done' } }, { id: 't-21', to: { name: 'In Progress' } }] } as T
    const key = decodeURIComponent(/\/issue\/([^?/]+)/.exec(path)![1]!)
    return { id: key, key, fields: issues[key] } as T
  }
  const editor = jiraEditor({
    rest,
    keyOf: () => 'ABC',
    list: async () => [],
    priorities: async () => [{ id: '1', name: 'Highest' }, { id: '2', name: 'High' }, { id: '3', name: 'Medium' }, { id: '4', name: 'Low' }],
    versionsOf: async () => [{ id: 'v1', name: '1.0' }, { id: 'v2', name: '2.0' }],
    issueTypes: async () => [{ id: 'epic', name: 'Epic', hierarchyLevel: 1 }, { id: 'task', name: 'Task', hierarchyLevel: 0 }, { id: 'sub', name: 'Subtask', subtask: true, hierarchyLevel: -1 }],
    linkTypes: ['Blocks', 'Relates', 'Duplicate'],
    relabel: async () => [],
    comment: async (id, body) => {
      comments.push([id, body])
      return 'c-1'
    },
    componentsOf: async () => [{ id: 'c-ui', name: 'UI' }, { id: 'c-server', name: 'Server' }],
    upload: async (id, files) => void uploads.push([id, files.map((file) => file.name)]),
  })
  const read = (key: string): JiraIssue => ({ id: key, key, fields: issues[key]! })
  return { editor, writes, issues, comments, uploads, recent, searches, read }
}

describe('jiraEditor', () => {
  it('creates a retry marker as an issue property without changing the description', async () => {
    const { editor, writes } = fixture()
    const marker = editor.markers!.make()
    expect(marker).not.toBe(editor.markers!.make())
    await editor.create('P1', { title: 'New', description: '', status: null, priority: null, milestone: null, labels: [], parent: null }, [], marker)
    expect(writes).toEqual([['POST', '/issue', { fields: { project: { key: 'ABC' }, issuetype: { id: 'task' }, summary: 'New', description: markdownToAdf('') }, properties: [{ key: 'even-keel', value: marker }] }]])
  })

  it('finds the exact marker property on the newest project issues and propagates failures', async () => {
    const { editor, recent, searches } = fixture()
    const marker = editor.markers!.make()
    recent.issues = [{ key: 'ABC-9' }, { key: 'ABC-8', properties: { 'even-keel': `${marker}x` } }]
    expect(await editor.markers!.find('P1', marker)).toBeNull()
    recent.issues.push({ key: 'ABC-7', properties: { 'even-keel': marker } })
    expect(await editor.markers!.find('P1', marker, 7)).toBe('ABC-7')
    expect(searches).toEqual([{ jql: 'project = "ABC" ORDER BY created DESC', fields: [], maxResults: 25, properties: ['even-keel'] }, { jql: 'project = "ABC" ORDER BY created DESC', fields: [], maxResults: 7, properties: ['even-keel'] }])
    recent.issues = []
    expect(await editor.markers!.find('P1', marker)).toBeNull()
    recent.error = new Error('offline')
    await expect(editor.markers!.find('P1', marker)).rejects.toThrow('offline')
  })

  it('creates a task under an epic with every field, then moves it through a transition', async () => {
    const { editor, writes } = fixture()
    expect(await editor.create('P1', { title: 'New', description: 'Text', status: 'In Progress', priority: 'urgent', milestone: '2.0', labels: ['bug'], parent: 'ABC-1' })).toBe('ABC-10')
    expect(writes).toEqual([
      ['POST', '/issue', { fields: { project: { key: 'ABC' }, issuetype: { id: 'task' }, summary: 'New', description: markdownToAdf('Text'), priority: { id: '1' }, fixVersions: [{ id: 'v2' }], labels: ['bug'], parent: { key: 'ABC-1' } } }],
      ['POST', '/issue/ABC-10/transitions', { transition: { id: 't-21' } }],
    ])
  })

  it('keeps an estimate in minutes as the original estimate, on create and on its own', async () => {
    const { editor, writes, issues } = fixture()
    await editor.create('P1', { title: 'New', description: '', status: null, priority: null, milestone: null, labels: [], parent: null, estimate: 20 })
    expect((writes[0]![2] as { fields: { timetracking: unknown } }).fields.timetracking).toEqual({ originalEstimate: '20m' })
    issues['ABC-2']!.timetracking = { originalEstimate: '20m', originalEstimateSeconds: 1200 }
    expect(await editor.estimate!('ABC-2', 20)).toBe(false)
    expect(await editor.estimate!('ABC-2', 80)).toBe(true)
    expect(await editor.estimate!('ABC-3', 5)).toBe(true)
    expect(writes.slice(1)).toEqual([
      ['PUT', '/issue/ABC-2', { fields: { timetracking: { originalEstimate: '80m' } } }],
      ['PUT', '/issue/ABC-3', { fields: { timetracking: { originalEstimate: '5m' } } }],
    ])
  })

  it('takes the sub-task type under a standard parent, refuses one under a sub-task, and says a created task stays', async () => {
    const { editor, writes } = fixture()
    await editor.create('P1', { title: 'Child', description: '', status: null, priority: null, milestone: null, labels: [], parent: 'ABC-2' })
    expect((writes[0]![2] as { fields: { issuetype: unknown } }).fields.issuetype).toEqual({ id: 'sub' })
    await expect(editor.create('P1', { title: 'Child', description: '', status: null, priority: null, milestone: null, labels: [], parent: 'ABC-3' })).rejects.toThrow(/sub-task has no children/)
    await expect(editor.create('P1', { title: 'New', description: '', status: 'Review', priority: null, milestone: null, labels: [], parent: null })).rejects.toThrow(
      /ABC-10 was created, but .*no transition from To Do to "Review"; from here it goes to Done, In Progress; do not create it again/,
    )
  })

  it('sets fields, keeps the version as the only one and refuses a priority of none', async () => {
    const { editor, writes } = fixture()
    expect(await editor.set('ABC-1', { field: 'priority', to: 'medium' })).toBe(false)
    expect(await editor.set('ABC-1', { field: 'priority', to: 'low' })).toBe(true)
    await expect(editor.set('ABC-1', { field: 'priority', to: 'none' })).rejects.toThrow(/keeps a priority on every issue/)
    expect(await editor.set('ABC-1', { field: 'milestone', to: '1.0' })).toBe(false)
    expect(await editor.set('ABC-1', { field: 'milestone', to: null })).toBe(true)
    expect(await editor.set('ABC-2', { field: 'milestone', to: '2.0' })).toBe(true)
    expect(await editor.set('ABC-2', { field: 'parent', to: 'abc-1' })).toBe(false)
    expect(await editor.set('ABC-2', { field: 'parent', to: null })).toBe(true)
    expect(await editor.set('ABC-1', { field: 'status', to: 'to do' })).toBe(false)
    expect(await editor.set('ABC-1', { field: 'status', to: 'Done' })).toBe(true)
    expect(writes).toEqual([
      ['PUT', '/issue/ABC-1', { fields: { priority: { id: '4' } } }],
      ['PUT', '/issue/ABC-1', { fields: { fixVersions: [] } }],
      ['PUT', '/issue/ABC-2', { fields: { fixVersions: [{ id: 'v2' }] } }],
      ['PUT', '/issue/ABC-2', { fields: { parent: null } }],
      ['POST', '/issue/ABC-1/transitions', { transition: { id: 't-31' } }],
    ])
  })

  it('creates with one component and sets it as the only one, by name (BTN-895)', async () => {
    const { editor, writes, issues } = fixture()
    expect(editor.components).toBe(true)
    await editor.create('P1', { title: 'New', description: '', status: null, priority: null, milestone: null, labels: [], parent: null, component: 'ui' })
    expect((writes[0]![2] as { fields: { components: unknown } }).fields.components).toEqual([{ id: 'c-ui' }])
    await expect(editor.create('P1', { title: 'New', description: '', status: null, priority: null, milestone: null, labels: [], parent: null, component: 'Docs' })).rejects.toThrow(/no component "Docs" in ABC/)
    issues['ABC-1']!.components = [{ id: 'c-ui', name: 'UI' }, { id: 'c-server', name: 'Server' }]
    issues['ABC-2']!.components = [{ id: 'c-ui', name: 'UI' }]
    expect(await editor.set('ABC-2', { field: 'component', to: 'UI' })).toBe(false)
    expect(await editor.set('ABC-1', { field: 'component', to: 'UI' })).toBe(true)
    expect(await editor.set('ABC-3', { field: 'component', to: null })).toBe(false)
    expect(await editor.set('ABC-2', { field: 'component', to: null })).toBe(true)
    expect(writes.slice(1)).toEqual([
      ['PUT', '/issue/ABC-1', { fields: { components: [{ id: 'c-ui' }] } }],
      ['PUT', '/issue/ABC-2', { fields: { components: [] } }],
    ])
  })

  it('attaches files to the issue, and a comment with files names them after its text', async () => {
    const { editor, comments, uploads } = fixture()
    const file = { name: 'shot.png', type: 'image/png', bytes: new Uint8Array([1]) }
    await editor.files!.attach('ABC-1', [file])
    expect(await editor.files!.comment('ABC-1', 'Look.\n', [file, { ...file, name: 'b.log' }], null)).toBe('c-1')
    expect(uploads).toEqual([['ABC-1', ['shot.png']], ['ABC-1', ['shot.png', 'b.log']]])
    expect(comments).toEqual([['ABC-1', 'Look.\n\nAttached: shot.png, b.log']])
    await expect(editor.files!.attach('nope', [file])).rejects.toThrow(/not a task key/)
  })

  it('links with the blocker inward and removes the requested direction', async () => {
    const { editor, writes } = fixture()
    await editor.link('ABC-2', 'ABC-3', 'blockedBy', true)
    await editor.link('ABC-2', 'ABC-3', 'blocks', true)
    await editor.link('ABC-2', 'ABC-3', 'blocks', false)
    await editor.link('ABC-2', 'ABC-3', 'blockedBy', false)
    await editor.link('ABC-2', 'ABC-1', 'relates', false)
    await editor.link('ABC-1', 'ABC-3', 'relates', true)
    expect(writes).toEqual([
      ['POST', '/issueLink', { type: { name: 'Blocks' }, inwardIssue: { key: 'ABC-2' }, outwardIssue: { key: 'ABC-3' } }],
      ['DELETE', '/issueLink/l-3', undefined],
      ['DELETE', '/issueLink/l-1', undefined],
      ['DELETE', '/issueLink/l-2', undefined],
      ['POST', '/issueLink', { type: { name: 'Relates' }, outwardIssue: { key: 'ABC-1' }, inwardIssue: { key: 'ABC-3' } }],
    ])
  })

  it.each(['blocks', 'blockedBy'] as const)('creates %s in the direction read by the cards and chain, without duplicates', async (link) => {
    const { editor, writes, read } = fixture()
    const [blocker, blocked] = link === 'blocks' ? ['ABC-1', 'ABC-3'] : ['ABC-3', 'ABC-1']
    await editor.link('ABC-1', 'ABC-3', link, true)
    expect(writes).toEqual([
      ['POST', '/issueLink', { type: { name: 'Blocks' }, inwardIssue: { key: blocker }, outwardIssue: { key: blocked } }],
    ])
    expect(toCard(read(blocker), [], []).blocks.map((each) => each.id)).toEqual([blocked])
    expect(toCard(read(blocked), [], []).blockedBy.map((each) => each.id)).toEqual([blocker])
    expect(toTrackerTask(read(blocked), []).blockedBy).toEqual([blocker])
    expect(toTrackerTask(read(blocker), []).blockedBy).toEqual([])
    await editor.link('ABC-1', 'ABC-3', link, true)
    expect(writes).toHaveLength(1)
    await editor.link('ABC-1', 'ABC-3', link, false)
    expect(writes.at(-1)).toEqual(['DELETE', '/issueLink/l-3', undefined])
    expect(toCard(read(blocker), [], []).blocks).toEqual([])
    expect(toTrackerTask(read(blocked), []).blockedBy).toEqual([])
    await expect(editor.link('ABC-1', 'ABC-3', link, false)).rejects.toThrow(`ABC-1 has no "${link}" link to ABC-3`)
    expect(writes).toHaveLength(2)
  })

  it.each(['blocks', 'blockedBy', 'relates'] as const)('refuses to remove an absent %s link, including missing link data', async (link) => {
    const { editor, writes, issues } = fixture()
    for (const issuelinks of [undefined, [], [{ id: 'different', type: { name: 'Duplicate' }, outwardIssue: ref('ABC-3') }]]) {
      issues['ABC-1']!.issuelinks = issuelinks
      await expect(editor.link('ABC-1', 'ABC-3', link, false)).rejects.toThrow(`ABC-1 has no "${link}" link to ABC-3`)
    }
    expect(writes).toEqual([])
  })

  it('refuses to remove the opposite blocking direction', async () => {
    const { editor, writes } = fixture()
    await expect(editor.link('ABC-2', 'ABC-3', 'blocks', false)).rejects.toThrow('ABC-2 has no "blocks" link to ABC-3')
    expect(writes).toEqual([])
  })

  it('patches the description through Markdown and writes it back as ADF', async () => {
    const { editor, writes } = fixture()
    expect(await editor.revision('ABC-1')).toBe(revisionOf('Old text'))
    expect(await editor.patch('ABC-1', [{ old: 'Old', new: 'New' }], null)).toBe(true)
    expect(writes).toEqual([['PUT', '/issue/ABC-1', { fields: { description: markdownToAdf('New text') } }]])
  })
})
