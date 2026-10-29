import { describe, expect, it } from 'vitest'
import { connectGitlab } from './source.js'
import { issue, linked } from './fixture.js'

const web = 'https://gitlab.example.com'
const path = 'group/subgroup/app'
const settings = { web, token: 'fake', projects: { p: { key: 'APP', value: path } } }
const pageInfo = { hasNextPage: false, endCursor: null }

function fixture(count: number, fallback = false) {
  const calls: { path: string; body: unknown }[] = []
  let active = 0
  let peak = 0
  const issues = Array.from({ length: count }, (_, n) => issue({ iid: n + 1, milestone: null, web_url: `${web}/${path}/-/issues/${n + 1}` }))
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    const body = init?.body ? JSON.parse(String(init.body)) as { query: string; variables: { iids?: string[]; iid?: string } } : undefined
    calls.push({ path: url.pathname, body })
    let result: unknown
    if (url.pathname.endsWith('/user')) result = { id: 9 }
    else if (url.pathname === '/api/graphql') {
      if (fallback && body!.query.includes('WorkItemWidgetLinkedItems')) result = { errors: [{ message: 'No linked widget', extensions: { code: 'undefinedType' } }] }
      else result = { data: { project: { workItems: { pageInfo, nodes: (body!.variables.iids ?? [body!.variables.iid]).map((iid) => ({ iid, widgets: [
        { parent: null, children: { nodes: [], pageInfo } },
        ...fallback ? [] : [{ linkedItems: { nodes: [{ linkType: 'is_blocked_by', workItem: { iid: '99', title: 'Blocker', state: 'OPEN', webUrl: `${web}/${path}/-/issues/99` } }], pageInfo } }],
      ] })) } } } }
    } else if (url.pathname.endsWith('/links')) {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active--
      result = [linked('is_blocked_by', 99)]
    } else if (/\/issues\/\d+$/.test(url.pathname)) result = issues.find((each) => each.iid === Number(url.pathname.split('/').at(-1)))
    else result = issues
    return new Response(JSON.stringify(result), { headers: { 'x-next-page': '' } })
  }
  return { fetchImpl, calls, issues, peak: () => peak }
}

describe('GitLab batched task reads', () => {
  it('reads N issues and their relations in one GraphQL batch, also for status polls', async () => {
    const fake = fixture(14)
    const source = await connectGitlab(settings, 1000, fake.fetchImpl)
    const { tasks } = await source.chainTasks('p', (status) => status.category !== 'Won')
    expect(tasks).toHaveLength(14)
    expect(tasks.every((task) => task.blockedBy[0] === 'APP-99')).toBe(true)
    expect(fake.calls).toHaveLength(3)
    const before = fake.calls.length
    expect(await source.tasks(tasks.map((task) => task.id))).toHaveLength(14)
    expect(fake.calls.length - before).toBe(15)
    expect(fake.calls.filter((call) => call.path === '/api/graphql')).toHaveLength(2)
  })

  it('falls back to at most six simultaneous REST link reads when the linked widget is unavailable', async () => {
    const fake = fixture(14, true)
    const source = await connectGitlab(settings, 1000, fake.fetchImpl)
    const { tasks } = await source.chainTasks('p', (status) => status.category !== 'Won')
    expect(tasks.every((task) => task.blockedBy[0] === 'APP-99')).toBe(true)
    expect(fake.calls.filter((call) => call.path === '/api/graphql')).toHaveLength(2)
    expect(fake.peak()).toBe(6)
  })

  it('bounds batches on a large read and does not cache relations across polls', async () => {
    const fake = fixture(45)
    const source = await connectGitlab(settings, 1000, fake.fetchImpl)
    for (let read = 0; read < 2; read++) {
      expect((await source.chainTasks('p', (status) => status.category !== 'Won')).tasks).toHaveLength(45)
      expect(fake.calls.filter((call) => call.path === '/api/graphql')).toHaveLength((read + 1) * 3)
    }
  })

  it('reads the status of closed issues outside active milestones without their relations', async () => {
    const fake = fixture(3)
    fake.issues[1]!.state = 'closed'
    fake.issues[2]!.state = 'closed'
    const source = await connectGitlab(settings, 1000, fake.fetchImpl)
    const tasks = await source.tasks(['APP-1', 'APP-2', 'APP-3'])
    expect(tasks.map((each) => each.status.category)).toEqual(['ToDo', 'Won', 'Won'])
    const graph = fake.calls.find((each) => each.path === '/api/graphql')!
    expect(graph.body).toMatchObject({ variables: { iids: ['1'] } })
    expect(fake.calls.filter((each) => each.path.endsWith('/links'))).toEqual([])
  })
})
