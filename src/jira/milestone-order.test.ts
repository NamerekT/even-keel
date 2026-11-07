import { describe, expect, it } from 'vitest'
import { fakeFetch, issue, TODO } from './fixture.js'
import { connectJira } from './source.js'

const settings = { values: { JIRA_URL: 'https://example.atlassian.net', JIRA_EMAIL: 'john.doe@example.com', JIRA_TOKEN: 'fake' }, projects: { p: { key: 'ABC' } } }
const signIn = [{ body: { accountId: 'fake' } }, { body: { issueLinkTypes: [{ name: 'Blocks' }] } }]
const priorities = { body: { values: [] } }
const versions = [{ id: '20', name: 'GA', releaseDate: '2026-11-01' }, { id: '10', name: 'MVP', releaseDate: '2026-12-01' }]
const page = (values: unknown[], isLast = true) => ({ body: { values, isLast } })

describe('Jira native milestone positions', () => {
  it('paginates by sequence, selects the earliest native fix version and reloads on the next read', async () => {
    const raw = () => issue('ABC-1', { fixVersions: [...versions].reverse() })
    const fake = fakeFetch([...signIn, { body: { issues: [raw()] } }, priorities, page([versions[0]], false), page([versions[1]]),
      { body: { issues: [raw()] } }, page([...versions].reverse())])
    const source = await connectJira(settings, 1000, fake.fetch)
    expect((await source.tasks(['ABC-1']))[0]!.milestone).toEqual({
      label: 'GA', targetDate: Date.parse('2026-11-01'), trackerOrder: { source: 'jira:ABC', value: 0 },
    })
    expect(fake.calls[4]!.url).toContain('/project/ABC/version?orderBy=sequence&startAt=0&maxResults=100')
    expect(fake.calls[5]!.url).toContain('startAt=1')
    expect((await source.tasks(['ABC-1']))[0]!.milestone?.label).toBe('MVP')
    expect(fake.remaining()).toBe(0)
  })

  it('keeps positions through released and archived versions in the picker and current card', async () => {
    const catalog = [{ ...versions[0]!, archived: true }, versions[1]!]
    const fake = fakeFetch([...signIn,
      { body: { fields: { fixVersions: versions } } }, page(catalog),
      { body: issue('ABC-1', { fixVersions: versions }) }, { body: { comments: [], total: 0 } }, priorities, page(catalog)])
    const source = await connectJira(settings, 1000, fake.fetch)
    const pick = await source.milestones!('ABC-1')
    expect(pick.current).toBe('20')
    expect(pick.choices.map((each) => [each.id, each.trackerOrder?.value])).toEqual([['10', 1], ['20', 0]])
    expect((await source.card!('ABC-1')).milestone?.trackerOrder?.value).toBe(0)
  })

  it('propagates catalog errors and retries without stale positions', async () => {
    const raw = () => ({ body: { issues: [issue('ABC-1', { fixVersions: versions })] } })
    const fake = fakeFetch([...signIn, raw(), priorities, { status: 403 }, raw(), page([])])
    const source = await connectJira(settings, 1000, fake.fetch)
    await expect(source.tasks(['ABC-1'])).rejects.toThrow()
    expect((await source.tasks(['ABC-1']))[0]!.milestone?.trackerOrder).toBeUndefined()
    expect(fake.remaining()).toBe(0)
  })

  it('reads a project catalog once for all tasks in a chain poll', async () => {
    const fake = fakeFetch([...signIn, { body: [{ statuses: [TODO] }] },
      { body: { issues: [issue('ABC-1', { fixVersions: versions }), issue('ABC-2', { fixVersions: [versions[1]!] })] } }, priorities, page(versions)])
    const source = await connectJira(settings, 1000, fake.fetch)
    const result = await source.chainTasks('p', () => true)
    expect(result.tasks.map((task) => task.milestone?.trackerOrder?.value)).toEqual([0, 1])
    expect(fake.remaining()).toBe(0)
  })
})
