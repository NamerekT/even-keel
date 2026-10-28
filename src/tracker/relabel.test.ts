import { describe, expect, it } from 'vitest'
import { connectGithub } from '../github/source.js'
import { connectGitlab } from '../gitlab/source.js'
import { connectLinear } from '../linear/source.js'
import { connectJira } from '../jira/source.js'

const page = (nodes: unknown[], after: string | null = null) => ({ nodes, pageInfo: { hasNextPage: after !== null, endCursor: after } })
const data = (data: unknown) => ({ data })
const labels = [{ id: 'keep', name: 'Bug' }, { id: 'old', name: 'Old' }]
const change = { remove: ['OLD'], add: ['BUG', 'New', 'new'] }

function replies(bodies: unknown[]) {
  const calls: { url: string; body: any; method: string }[] = []
  const fetch = async (url: any, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body === undefined ? undefined : JSON.parse(String(init.body)), method: init?.method ?? 'GET' })
    if (bodies.length === 0) throw new Error('unexpected request')
    const body = bodies.shift()
    return new Response(JSON.stringify(body), { status: (body as any)?.denied ? 403 : 200 })
  }
  return { fetch: fetch as typeof globalThis.fetch, calls, remaining: () => bodies.length }
}

describe('tracker label writes', () => {
  it('GitHub pages repository labels, creates missing ones, and replaces the issue labels once', async () => {
    const fake = replies([
      data({ viewer: { login: 'example' } }),
      data({ repository: { issue: { id: 'issue', labels: page(labels) } } }),
      data({ repository: { id: 'repo', labels: page([labels[0]], 'next') } }),
      data({ repository: { id: 'repo', labels: page([labels[1]]) } }),
      data({ createLabel: { label: { id: 'new', name: 'New' } } }),
      data({ updateIssue: { issue: { labels: page([labels[0], { name: 'New' }]) } } }),
    ])
    const source = await connectGithub({ token: 'example', projects: { APP: { key: 'APP', value: 'example/app' } } }, 1000, fake.fetch)
    expect(await source.relabel!('APP-1', change)).toEqual(['Bug', 'New'])
    expect(fake.calls.at(-1)!.body.variables).toMatchObject({ id: 'issue', labels: ['keep', 'new'] })
    expect(fake.calls[3]!.body.variables.after).toBe('next')
    expect(fake.remaining()).toBe(0)
  })

  it('Linear uses workspace and team labels and creates new labels in the issue team', async () => {
    const fake = replies([
      data({ organization: { urlKey: 'example' } }),
      data({ issues: { nodes: [{ id: 'issue', team: { id: 'team' }, labels: page(labels) }] } }),
      data({ issueLabels: page([{ ...labels[0], isGroup: false }, { id: 'group', name: 'New', isGroup: true }], 'next') }),
      data({ issueLabels: page([{ ...labels[1], isGroup: false }]) }),
      data({ issueLabelCreate: { success: true, issueLabel: { id: 'new', name: 'New' } } }),
      data({ issueUpdate: { success: true, issue: { labels: page([labels[0], { name: 'New' }]) } } }),
    ])
    const source = await connectLinear({ token: 'example', projects: {} }, 1000, fake.fetch)
    expect(await source.relabel!('APP-1', change)).toEqual(['Bug', 'New'])
    expect(fake.calls[4]!.body.variables.input).toMatchObject({ name: 'New', teamId: 'team' })
    expect(fake.calls.at(-1)!.body.variables).toMatchObject({ id: 'issue', labels: ['keep', 'new'] })
    expect(fake.remaining()).toBe(0)
  })

  it('GitLab reuses a project label in another case and creates a missing project label', async () => {
    const fake = replies([{ id: 1 }, { labels: ['Bug', 'Old'] }, [{ name: 'Bug' }, { name: 'NEW' }], { name: 'Other' }, { labels: ['Bug', 'NEW', 'Other'] }])
    const source = await connectGitlab({ token: 'example', web: 'https://gitlab.example.com', projects: { APP: { key: 'APP', value: 'example/app' } } }, 1000, fake.fetch)
    expect(await source.relabel!('APP-1', { ...change, add: [...change.add, 'Other'] })).toEqual(['Bug', 'NEW', 'Other'])
    expect(fake.calls[3]).toMatchObject({ method: 'POST', body: { name: 'Other', color: '#808080' } })
    expect(fake.calls[4]).toMatchObject({ method: 'PUT', body: { labels: 'Bug,NEW,Other' } })
  })

  it('Jira writes free labels and returns the labels read back after its empty update response', async () => {
    const fake = replies([{ accountId: 'example' }, { issueLinkTypes: [{ name: 'Blocks' }] }, { fields: { labels: ['Bug', 'Old'] } }, {}, { fields: { labels: ['Bug', 'New'] } }])
    const source = await connectJira({ values: { JIRA_URL: 'https://example.atlassian.net', JIRA_EMAIL: 'john@example.com', JIRA_TOKEN: 'example' }, projects: {} }, 1000, fake.fetch)
    expect(await source.relabel!('APP-1', change)).toEqual(['Bug', 'New'])
    expect(fake.calls[3]).toMatchObject({ method: 'PUT', body: { fields: { labels: ['Bug', 'New'] } } })
  })

  it.each(['github', 'linear', 'gitlab', 'jira'] as const)('%s propagates a label permission failure', async (kind) => {
    const fake = replies(kind === 'github' ? [data({ viewer: { login: 'example' } }), { denied: true }]
      : kind === 'linear' ? [data({ organization: { urlKey: 'example' } }), { denied: true }]
      : kind === 'gitlab' ? [{ id: 1 }, { denied: true }]
      : [{ accountId: 'example' }, { issueLinkTypes: [{ name: 'Blocks' }] }, { denied: true }])
    const source = kind === 'github' ? await connectGithub({ token: 'example', projects: { APP: { key: 'APP', value: 'example/app' } } }, 1000, fake.fetch)
      : kind === 'linear' ? await connectLinear({ token: 'example', projects: {} }, 1000, fake.fetch)
      : kind === 'gitlab' ? await connectGitlab({ token: 'example', web: 'https://gitlab.example.com', projects: { APP: { key: 'APP', value: 'example/app' } } }, 1000, fake.fetch)
      : await connectJira({ values: { JIRA_URL: 'https://example.atlassian.net', JIRA_EMAIL: 'john@example.com', JIRA_TOKEN: 'example' }, projects: {} }, 1000, fake.fetch)
    await expect(source.relabel!('APP-1', change)).rejects.toThrow('403')
  })

  it.each(['github', 'linear', 'gitlab', 'jira'] as const)('%s reports a refused write after reading the current labels', async (kind) => {
    const denied = { denied: true }
    const fake = replies(kind === 'github' ? [data({ viewer: { login: 'example' } }), data({ repository: { issue: { id: 'issue', labels: page(labels) } } }), data({ repository: { id: 'repo', labels: page(labels) } }), denied]
      : kind === 'linear' ? [data({ organization: { urlKey: 'example' } }), data({ issues: { nodes: [{ id: 'issue', team: { id: 'team' }, labels: page(labels) }] } }), data({ issueLabels: page(labels) }), denied]
      : kind === 'gitlab' ? [{ id: 1 }, { labels: ['Bug', 'Old'] }, [{ name: 'Bug' }], denied]
      : [{ accountId: 'example' }, { issueLinkTypes: [{ name: 'Blocks' }] }, { fields: { labels: ['Bug', 'Old'] } }, denied])
    const source = kind === 'github' ? await connectGithub({ token: 'example', projects: { APP: { key: 'APP', value: 'example/app' } } }, 1000, fake.fetch)
      : kind === 'linear' ? await connectLinear({ token: 'example', projects: {} }, 1000, fake.fetch)
      : kind === 'gitlab' ? await connectGitlab({ token: 'example', web: 'https://gitlab.example.com', projects: { APP: { key: 'APP', value: 'example/app' } } }, 1000, fake.fetch)
      : await connectJira({ values: { JIRA_URL: 'https://example.atlassian.net', JIRA_EMAIL: 'john@example.com', JIRA_TOKEN: 'example' }, projects: {} }, 1000, fake.fetch)
    await expect(source.relabel!('APP-1', { remove: ['OLD'], add: ['BUG'] })).rejects.toThrow('403')
    expect(fake.remaining()).toBe(0)
  })

  it('GitHub reads every page of the current and saved labels and can remove all labels', async () => {
    const fake = replies([
      data({ viewer: { login: 'example' } }),
      data({ repository: { issue: { id: 'issue', labels: page([labels[0]], 'current-next') } } }),
      data({ repository: { issue: { labels: page([labels[1]]) } } }),
      data({ repository: { id: 'repo', labels: page(labels) } }),
      data({ updateIssue: { issue: { labels: page([], 'saved-next') } } }),
      data({ repository: { issue: { labels: page([]) } } }),
    ])
    const source = await connectGithub({ token: 'example', projects: { APP: { key: 'APP', value: 'example/app' } } }, 1000, fake.fetch)
    expect(await source.relabel!('APP-1', { add: [], remove: ['BUG', 'OLD'] })).toEqual([])
    expect(fake.calls[4]!.body.variables.labels).toEqual([])
    expect(fake.calls[5]!.body.variables.after).toBe('saved-next')
  })

  it('Linear reads every page of the current and saved labels', async () => {
    const fake = replies([
      data({ organization: { urlKey: 'example' } }),
      data({ issues: { nodes: [{ id: 'issue', team: { id: 'team' }, labels: page([labels[0]], 'current-next') }] } }),
      data({ issues: { nodes: [{ labels: page([labels[1]]) }] } }),
      data({ issueLabels: page(labels) }),
      data({ issueUpdate: { success: true, issue: { labels: page([labels[0]], 'saved-next') } } }),
      data({ issues: { nodes: [{ labels: page([labels[1]]) }] } }),
    ])
    const source = await connectLinear({ token: 'example', projects: {} }, 1000, fake.fetch)
    expect(await source.relabel!('APP-1', { add: ['BUG'], remove: [] })).toEqual(['Bug', 'Old'])
    expect(fake.calls[4]!.body.variables.labels).toEqual(['keep', 'old'])
    expect(fake.calls[5]!.body.variables.after).toBe('saved-next')
  })

  it.each(['create', 'update'] as const)('Linear refuses an unsuccessful %s mutation', async (operation) => {
    const fake = replies([
      data({ organization: { urlKey: 'example' } }),
      data({ issues: { nodes: [{ id: 'issue', team: { id: 'team' }, labels: page([]) }] } }),
      data({ issueLabels: page(labels) }),
      operation === 'create' ? data({ issueLabelCreate: { success: false, issueLabel: null } }) : data({ issueUpdate: { success: false, issue: null } }),
    ])
    const source = await connectLinear({ token: 'example', projects: {} }, 1000, fake.fetch)
    await expect(source.relabel!('APP-1', { add: [operation === 'create' ? 'New' : 'Bug'], remove: [] })).rejects.toThrow('refused')
  })
})
