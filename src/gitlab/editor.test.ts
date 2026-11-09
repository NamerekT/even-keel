import { describe, expect, it } from 'vitest'
import { revisionOf } from '../tracker/editor.js'
import { gitlabEditor } from './editor.js'
import { issue, linked } from './fixture.js'
import { ProjectMap, type GitlabIssue } from './model.js'

const WEB = 'https://gitlab.example.com'
const BASE = '/projects/group%2Fsubgroup%2Fapp/issues'
const url = (iid: number) => `${WEB}/group/subgroup/app/-/issues/${iid}`

function fixture(made: string | undefined = undefined) {
  const recent = { issues: [] as unknown[], error: null as Error | null }
  const reads: string[] = []
  const issues: Record<number, GitlabIssue> = {
    1: issue({ iid: 1, web_url: url(1), issue_type: 'issue', description: 'Old text' }),
    2: issue({ iid: 2, web_url: url(2), issue_type: 'issue', labels: ['bug'], milestone: null, time_stats: { time_estimate: 1200 } }),
    3: issue({ iid: 3, web_url: url(3), issue_type: 'task', state: 'closed', labels: [] }),
    10: issue({ iid: 10, web_url: url(10) }),
  }
  const links = { 1: [{ ...linked('is_blocked_by', 3), issue_link_id: 71 }, { ...linked('relates_to', 2), issue_link_id: 72 }] } as Record<number, ReturnType<typeof linked>[]>
  const writes: [string, string, unknown][] = []
  const graphqlCalls: Record<string, unknown>[] = []
  const relabels: [string, unknown][] = []
  const comments: [string, string][] = []
  const uploaded: [string, string][] = []
  let refuseParent = false
  const rest = async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
    if (method === 'GET' && path.includes('?')) {
      reads.push(path)
      if (recent.error !== null) throw recent.error
      return recent.issues as T
    }
    if (method !== 'GET') {
      writes.push([method, path, body])
      const description = (body as { description?: string } | undefined)?.description
      if (description !== undefined && (path === BASE || path === `${BASE}/10`)) issues[10]!.description = description
      if (path.endsWith('/links')) {
        const { target_issue_iid: target, link_type: asked } = body as { target_issue_iid: number; link_type: string }
        const type = (made ?? asked) as Parameters<typeof linked>[0]
        const iid = Number(/\/issues\/(\d+)\/links$/.exec(path)![1])
        links[iid] = [...(links[iid] ?? []), { ...linked(type, target), issue_link_id: 99 }]
        return { link_type: type } as T
      }
      return { iid: 10, id: 110 } as T
    }
    return issues[Number(/\/issues\/(\d+)$/.exec(path)![1])] as T
  }
  const editor = gitlabEditor({
    rest,
    graphql: async <T>(_query: string, variables: Record<string, unknown>) => {
      graphqlCalls.push(variables)
      return { workItemUpdate: { errors: refuseParent ? ['Task cannot be a parent'] : [] } } as T
    },
    projects: new ProjectMap({ P1: { key: 'APP', value: 'group/subgroup/app' } }, WEB),
    list: async () => [],
    parentOf: async (_path, iid) => iid === 2 ? { iid: 1, title: 'Parent', state: 'opened', web_url: url(1) } : null,
    labelsOf: async () => [{ name: 'bug' }, { name: 'priority::high' }, { name: 'priority::medium' }],
    milestonesOf: async () => [{ id: 20, title: 'v1.0', due_date: null, state: 'active' }, { id: 21, title: 'v2.0', due_date: null, state: 'active' }],
    linksOf: async (_path, iid) => links[iid] ?? [],
    relabel: async (id, change) => {
      relabels.push([id, change])
      return []
    },
    comment: async (id, body) => {
      comments.push([id, body])
      return '5'
    },
    upload: async (path, file) => {
      uploaded.push([path, file.name])
      return { markdown: `${file.type.startsWith('image/') ? '!' : ''}[${file.name}](/uploads/${'a'.repeat(32)}/${file.name})` }
    },
  })
  return { editor, writes, graphqlCalls, relabels, comments, uploaded, recent, reads, refuse: () => { refuseParent = true } }
}

describe('gitlabEditor', () => {
  it('creates a retry marker in the description, including an empty one', async () => {
    const { editor, writes } = fixture()
    const marker = editor.markers!.make()
    expect(marker).not.toBe(editor.markers!.make())
    const draft = { title: 'New', description: 'Text', status: null, priority: null, milestone: null, labels: [], parent: null }
    await editor.create('P1', draft, [], marker)
    await editor.create('P1', { ...draft, description: '' }, [], marker)
    expect(writes.map((each) => each[2])).toEqual([{ title: 'New', description: `Text\n\n<!-- even-keel:${marker} -->` }, { title: 'New', description: `<!-- even-keel:${marker} -->` }])
    const comment = `<!-- even-keel:${marker} -->`
    expect(await editor.revision('APP-10')).toBe(revisionOf(comment))
    await editor.patch('APP-10', [], 'Section')
    expect(writes.at(-1)![2]).toEqual({ description: `${comment}\n\nSection` })
    await editor.describe('APP-10', 'Replacement', revisionOf(`${comment}\n\nSection`))
    expect(writes.at(-1)![2]).toEqual({ description: 'Replacement' })
  })

  it('finds an exact marker among the newest project issues and propagates failures', async () => {
    const { editor, recent, reads } = fixture()
    const marker = editor.markers!.make()
    recent.issues = [{ iid: 9, description: null }, { iid: 8, description: `<!-- even-keel:${marker}x -->` }]
    expect(await editor.markers!.find('P1', marker)).toBeNull()
    recent.issues.push({ iid: 7, description: `Text\n\n<!-- even-keel:${marker} -->` })
    expect(await editor.markers!.find('P1', marker, 7)).toBe('APP-7')
    expect(reads).toEqual([`${BASE}?state=all&scope=all&order_by=created_at&sort=desc&per_page=25`, `${BASE}?state=all&scope=all&order_by=created_at&sort=desc&per_page=7`])
    recent.issues = []
    expect(await editor.markers!.find('P1', marker)).toBeNull()
    recent.error = new Error('offline')
    await expect(editor.markers!.find('P1', marker)).rejects.toThrow('offline')
    await expect(editor.markers!.find('missing', marker)).rejects.toThrow(/no GitLab path/)
  })

  it('uploads files into the project and links them from the description or the note (BTN-895)', async () => {
    const { editor, writes, comments, uploaded } = fixture()
    expect(editor.components).toBeUndefined()
    const png = { name: 'shot.png', type: 'image/png', bytes: new Uint8Array([1]) }
    await editor.files!.attach('APP-1', [png, { name: 'a.log', type: 'text/plain', bytes: new Uint8Array([2]) }])
    const hash = 'a'.repeat(32)
    expect(writes).toEqual([['PUT', `${BASE}/1`, { description: `Old text\n\n![shot.png](/uploads/${hash}/shot.png)\n[a.log](/uploads/${hash}/a.log)` }]])
    expect(await editor.files!.comment('APP-2', 'Look.', [png], null)).toBe('5')
    expect(comments).toEqual([['APP-2', `Look.\n\n![shot.png](/uploads/${hash}/shot.png)`]])
    expect(uploaded.map(([path]) => path)).toEqual(['group/subgroup/app', 'group/subgroup/app', 'group/subgroup/app'])
  })

  it('keeps an estimate in minutes as the time estimate, after the create and on its own', async () => {
    const { editor, writes } = fixture()
    expect(await editor.create('P1', { title: 'New', description: '', status: null, priority: null, milestone: null, labels: [], parent: null, estimate: 20 })).toBe('APP-10')
    expect(writes).toEqual([
      ['POST', BASE, { title: 'New', description: '' }],
      ['POST', `${BASE}/10/time_estimate`, { duration: '20m' }],
    ])
    expect(await editor.estimate!('APP-2', 20)).toBe(false)
    expect(await editor.estimate!('APP-2', 80)).toBe(true)
    expect(writes.slice(2)).toEqual([['POST', `${BASE}/2/time_estimate`, { duration: '80m' }]])
  })

  it('keeps a priority only where the project has a priority label', () => {
    const { editor } = fixture()
    expect(editor.priorities!(['bug', 'priority::low'])).toBe(true)
    expect(editor.priorities!(['bug'])).toBe(false)
  })

  it('creates a task under an issue with every field: a task type, labels, the parent, then the close', async () => {
    const { editor, writes, graphqlCalls, relabels } = fixture()
    expect(await editor.create('P1', { title: 'New', description: 'Text', status: 'closed', priority: 'high', milestone: 'V2.0', labels: ['bug'], parent: 'APP-1' })).toBe('APP-10')
    expect(writes).toEqual([
      ['POST', BASE, { title: 'New', description: 'Text', issue_type: 'task', milestone_id: 21 }],
      ['PUT', `${BASE}/10`, { state_event: 'close' }],
    ])
    expect(relabels).toEqual([['APP-10', { add: ['bug', 'priority::high'], remove: [] }]])
    expect(graphqlCalls).toEqual([{ id: 'gid://gitlab/WorkItem/110', parent: 'gid://gitlab/WorkItem/101' }])
  })

  it('refuses a priority the project has no label for, before creating anything', async () => {
    const { editor, writes } = fixture()
    await expect(editor.create('P1', { title: 'New', description: '', status: null, priority: 'urgent', milestone: null, labels: [], parent: null })).rejects.toThrow(/label "priority::urgent"/)
    await expect(editor.create('P1', { title: 'New', description: '', status: 'Review', priority: null, milestone: null, labels: [], parent: null })).rejects.toThrow(/statuses are Opened, Closed/)
    expect(writes).toEqual([])
  })

  it('says a created task stays when GitLab refuses its parent', async () => {
    const { editor, refuse } = fixture()
    refuse()
    await expect(editor.create('P1', { title: 'New', description: '', status: null, priority: null, milestone: null, labels: [], parent: 'APP-3' })).rejects.toThrow(
      /APP-10 was created, but GitLab refused to put APP-10 under APP-3: Task cannot be a parent; do not create it again/,
    )
  })

  it('sets fields and skips the ones that hold the value already', async () => {
    const { editor, writes, graphqlCalls, relabels } = fixture()
    expect(await editor.set('APP-1', { field: 'status', to: 'opened' })).toBe(false)
    expect(await editor.set('APP-3', { field: 'status', to: 'Opened' })).toBe(true)
    expect(await editor.set('APP-1', { field: 'milestone', to: 'v1.0' })).toBe(false)
    expect(await editor.set('APP-1', { field: 'milestone', to: null })).toBe(true)
    expect(await editor.set('APP-2', { field: 'milestone', to: 'v2.0' })).toBe(true)
    expect(await editor.set('APP-1', { field: 'priority', to: 'medium' })).toBe(false)
    expect(await editor.set('APP-1', { field: 'priority', to: 'none' })).toBe(true)
    expect(await editor.set('APP-2', { field: 'parent', to: 'app-1' })).toBe(false)
    expect(await editor.set('APP-2', { field: 'parent', to: null })).toBe(true)
    expect(await editor.set('APP-1', { field: 'title', to: 'Renamed' })).toBe(true)
    expect(writes).toEqual([
      ['PUT', `${BASE}/3`, { state_event: 'reopen' }],
      ['PUT', `${BASE}/1`, { milestone_id: 0 }],
      ['PUT', `${BASE}/2`, { milestone_id: 21 }],
      ['PUT', `${BASE}/1`, { title: 'Renamed' }],
    ])
    expect(relabels).toEqual([['APP-1', { add: [], remove: ['priority::medium'] }]])
    expect(graphqlCalls).toEqual([{ id: 'gid://gitlab/WorkItem/102', parent: null }])
    await expect(editor.set('APP-1', { field: 'milestone', to: 'v9' })).rejects.toThrow(/no active milestone "v9"/)
  })

  it('links by link type, removes by the link id and refuses a second link of a linked pair', async () => {
    const { editor, writes } = fixture()
    await editor.link('APP-1', 'APP-3', 'blockedBy', true)
    await editor.link('APP-1', 'APP-3', 'blockedBy', false)
    await editor.link('APP-1', 'APP-10', 'blocks', true)
    await editor.link('APP-2', 'APP-3', 'relates', false)
    await expect(editor.link('APP-1', 'APP-2', 'blocks', true)).rejects.toThrow(/linked already as "relates_to"/)
    expect(writes).toEqual([
      ['DELETE', `${BASE}/1/links/71`, undefined],
      ['POST', `${BASE}/1/links`, { target_project_id: 'group/subgroup/app', target_issue_iid: 10, link_type: 'blocks' }],
    ])
  })

  it('takes back a "relates" link an instance without blocking links made instead', async () => {
    const { editor, writes } = fixture('relates_to')
    await expect(editor.link('APP-2', 'APP-10', 'blocks', true)).rejects.toThrow(/Premium/)
    expect(writes).toEqual([
      ['POST', `${BASE}/2/links`, { target_project_id: 'group/subgroup/app', target_issue_iid: 10, link_type: 'blocks' }],
      ['DELETE', `${BASE}/2/links/99`, undefined],
    ])
  })

  it('revises and patches the description as a hash of its text', async () => {
    const { editor, writes } = fixture()
    expect(await editor.revision('APP-1')).toBe(revisionOf('Old text'))
    expect(await editor.patch('APP-1', [{ old: 'Old', new: 'New' }], null)).toBe(true)
    expect(writes).toEqual([['PUT', `${BASE}/1`, { description: 'New text' }]])
  })
})
