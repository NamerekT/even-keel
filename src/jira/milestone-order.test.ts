import { describe, expect, it } from 'vitest'
import { fakeFetch, issue, TODO } from './fixture.js'
import { connectJira } from './source.js'

const settings = { values: { JIRA_URL: 'https://example.atlassian.net', JIRA_EMAIL: 'john.doe@example.com', JIRA_TOKEN: 'fake' }, projects: { p: { key: 'ABC' } } }
const signIn = [{ body: { accountId: 'fake' } }, { body: { issueLinkTypes: [{ name: 'Blocks' }] } }]
const priorities = { body: { values: [] } }
// In creation order, as the version catalog's `sequence` gives them; the Releases page shows them by release date.
const versions = [
  { id: '10', name: 'v1' },
  { id: '11', name: 'Pilot', releaseDate: '2027-03-01' },
  { id: '12', name: 'Launch', releaseDate: '2027-01-15' },
  { id: '13', name: 'Growth', releaseDate: '2026-12-01' },
]

describe('Jira milestone order', () => {
  it('takes the earliest fix version by release date and reads no version catalog', async () => {
    const fake = fakeFetch([...signIn, { body: { issues: [issue('ABC-1', { fixVersions: versions })] } }, priorities])
    const source = await connectJira(settings, 1000, fake.fetch)
    expect((await source.tasks(['ABC-1']))[0]!.milestone).toEqual({ label: 'Growth', targetDate: Date.parse('2026-12-01') })
    expect(fake.calls.some((call) => call.url.includes('orderBy=sequence'))).toBe(false)
    expect(fake.remaining()).toBe(0)
  })

  it('puts an undated version after the dated ones', async () => {
    const fake = fakeFetch([...signIn, { body: { issues: [issue('ABC-1', { fixVersions: [versions[0]!, versions[1]!] })] } }, priorities])
    const source = await connectJira(settings, 1000, fake.fetch)
    expect((await source.tasks(['ABC-1']))[0]!.milestone?.label).toBe('Pilot')
    expect(fake.remaining()).toBe(0)
  })

  it('gives the chain no tracker position for a version', async () => {
    const fake = fakeFetch([...signIn, { body: [{ statuses: [TODO] }] },
      { body: { issues: [issue('ABC-1', { fixVersions: [versions[1]!] }), issue('ABC-2', { fixVersions: [versions[3]!] })] } }, priorities])
    const source = await connectJira(settings, 1000, fake.fetch)
    const result = await source.chainTasks('p', () => true)
    expect(result.tasks.map((task) => task.milestone)).toEqual([
      { label: 'Pilot', targetDate: Date.parse('2027-03-01') },
      { label: 'Growth', targetDate: Date.parse('2026-12-01') },
    ])
    expect(fake.remaining()).toBe(0)
  })

  it('offers the open versions without positions and keeps the current one in the picker and the card', async () => {
    const catalog = [versions[0]!, versions[1]!, versions[2]!, { ...versions[3]!, archived: true }]
    const fake = fakeFetch([...signIn,
      { body: { fields: { fixVersions: [versions[1]!, versions[3]!] } } }, { body: catalog },
      { body: issue('ABC-1', { fixVersions: [versions[1]!, versions[3]!] }) }, { body: { comments: [], total: 0 } }, priorities])
    const source = await connectJira(settings, 1000, fake.fetch)
    const pick = await source.milestones!('ABC-1')
    expect(pick.current).toBe('13')
    expect(fake.calls[3]!.url).toContain('/project/ABC/versions')
    expect(pick.choices.map((each) => [each.id, each.trackerOrder])).toEqual([['10', undefined], ['11', undefined], ['12', undefined], ['13', undefined]])
    expect((await source.card!('ABC-1')).milestone).toEqual({ label: 'Growth', targetDate: Date.parse('2026-12-01') })
    expect(fake.remaining()).toBe(0)
  })
})
