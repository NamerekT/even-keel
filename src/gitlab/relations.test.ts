import { describe, expect, it } from 'vitest'
import { GitlabApi } from './api.js'
import { GitlabBatch } from './batch.js'
import { fakeFetch, linked, type Reply } from './fixture.js'
import { GitlabHierarchy } from './hierarchy.js'

const page = (endCursor: string | null = null) => ({ hasNextPage: endCursor !== null, endCursor })
const item = { iid: '2', title: 'Other', state: 'OPEN', webUrl: 'https://gitlab.example.com/group/app/-/issues/2' }
const tree = (endCursor: string | null = null) => ({ parent: item, children: { nodes: [item], pageInfo: page(endCursor) } })
const answer = (iid: number, widgets: unknown[], endCursor: string | null = null) => ({ data: { project: { workItems: { nodes: [{ iid: String(iid), widgets }], pageInfo: page(endCursor) } } } })

function setup(replies: Reply[]) {
  const fake = fakeFetch(replies)
  const api = new GitlabApi('https://gitlab.example.com', 'fake', 1000, fake.fetch)
  return { ...fake, batch: new GitlabBatch(api, new GitlabHierarchy(api), (_, iid) => api.collect(`/projects/example/issues/${iid}/links`)) }
}

describe('GitLab relation pagination and compatibility', () => {
  it('reads every work-item page and keeps hierarchy when links are not in the schema', async () => {
    const fake = setup([
      { body: { errors: [{ message: 'Old schema', extensions: { code: 'undefinedType' } }] } },
      { body: answer(1, [tree()], 'next') }, { body: answer(3, [tree()]) },
      { body: [linked('is_blocked_by', 2)] }, { body: [] },
      { body: answer(1, [tree()]) }, { body: [] },
    ])
    const rows = await fake.batch.read('group/app', [1, 3])
    expect([...rows.keys()]).toEqual([1, 3])
    expect(rows.get(1)).toMatchObject({ hierarchy: { parent: { iid: 2 }, children: [{ iid: 2 }] }, links: [{ link_type: 'is_blocked_by' }] })
    expect(fake.calls[2]!.body?.variables).toMatchObject({ after: 'next' })
    await fake.batch.read('group/app', [1])
    expect(fake.calls[5]!.body?.query).not.toContain('WorkItemWidgetLinkedItems')
    expect(fake.remaining()).toBe(0)
  })

  it('finishes overflowing child and link pages rather than silently truncating them', async () => {
    const fake = setup([
      { body: answer(1, [tree('children'), { linkedItems: { nodes: [], pageInfo: page('links') } }]) },
      { body: answer(1, [tree('children')]) }, { body: answer(1, [tree()]) },
      { body: [linked('blocks', 2)], next: '2' }, { body: [linked('is_blocked_by', 3)] },
    ])
    const rows = await fake.batch.read('group/app', [1])
    expect(rows.get(1)?.hierarchy.children).toHaveLength(2)
    expect(rows.get(1)?.links.map((each) => each.link_type)).toEqual(['blocks', 'is_blocked_by'])
    expect(fake.remaining()).toBe(0)
  })

  it('does not interpret authentication, runtime errors or broken pagination as empty relations', async () => {
    for (const reply of [{ status: 401, body: {} }, { body: { errors: [{ message: 'Unavailable' }] } }]) {
      const fake = setup([reply])
      await expect(fake.batch.read('group/app', [1])).rejects.toThrow()
      expect(fake.calls).toHaveLength(1)
    }
    const fake = setup([{ body: answer(1, [], 'same') }, { body: answer(1, [], 'same') }])
    await expect(fake.batch.read('group/app', [1])).rejects.toThrow('pagination')
  })
})
