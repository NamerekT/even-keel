import { describe, expect, it } from 'vitest'
import { GitlabApi } from './api.js'
import { fakeFetch, issue } from './fixture.js'
import { GitlabHierarchy } from './hierarchy.js'
import { ProjectMap, toTrackerTask } from './model.js'

const parent = { iid: '2', title: 'Parent', state: 'OPEN', webUrl: 'https://gitlab.example.com/group/subgroup/app/-/work_items/2' }
const child = { iid: '3', title: 'Child', state: 'CLOSED', webUrl: 'https://gitlab.example.com/group/subgroup/app/-/work_items/3' }
const answer = (nodes: unknown[], endCursor: string | null) => ({ data: { project: { workItems: { nodes: [{ widgets: [{ parent, children: { nodes, pageInfo: { hasNextPage: endCursor !== null, endCursor } } }] }] } } } })

describe('GitLab Free work item hierarchy', () => {
  it('collects every child page and maps a parent with a work_items URL', async () => {
    const fake = fakeFetch([{ body: answer([child], 'next') }, { body: answer([{ ...child, iid: '4' }], null) }])
    const hierarchy = await new GitlabHierarchy(new GitlabApi('https://gitlab.example.com', 'example', 1000, fake.fetch)).read('group/subgroup/app', 1)
    const projects = new ProjectMap({ p: { key: 'APP', value: 'group/subgroup/app' } }, 'https://gitlab.example.com')
    expect(toTrackerTask(issue(), [], projects, hierarchy)).toMatchObject({ parent: 'APP-2', subtasks: 2 })
    expect(hierarchy.children[0]!.state).toBe('closed')
    expect(fake.calls[1]!.body?.variables).toEqual({ path: 'group/subgroup/app', iid: '1', after: 'next' })
  })

  it('leaves unavailable old schemas empty and does not ask them again', async () => {
    const fake = fakeFetch([{ body: { errors: [{ message: 'No such field', extensions: { code: 'undefinedField' } }] } }])
    const hierarchy = new GitlabHierarchy(new GitlabApi('https://gitlab.example.com', 'example', 1000, fake.fetch))
    expect(await hierarchy.read('group/subgroup/app', 1)).toEqual({ parent: null, children: [] })
    expect(await hierarchy.read('group/subgroup/app', 2)).toEqual({ parent: null, children: [] })
    expect(fake.calls).toHaveLength(1)
  })

  it('propagates authentication and runtime errors instead of mistaking them for no children', async () => {
    const fake = fakeFetch([{ status: 401, body: {} }, { body: { errors: [{ message: 'Unavailable' }] } }])
    const hierarchy = new GitlabHierarchy(new GitlabApi('https://gitlab.example.com', 'example', 1000, fake.fetch))
    await expect(hierarchy.read('group/subgroup/app', 1)).rejects.toThrow('401')
    await expect(hierarchy.read('group/subgroup/app', 1)).rejects.toThrow('Unavailable')
  })
})
