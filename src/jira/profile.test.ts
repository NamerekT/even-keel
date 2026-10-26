import { describe, expect, it } from 'vitest'
import { CredentialsRefused } from '../tracker/source.js'
import { fakeFetch } from './fixture.js'
import { jiraAccount, jiraProjects } from './profile.js'

const VALUES = { JIRA_URL: 'https://example.atlassian.net/', JIRA_EMAIL: 'john.doe@example.com', JIRA_TOKEN: 'example-token' }

describe('Jira profile', () => {
  it('names the profile by the site and signs in as the e-mail', async () => {
    const fake = fakeFetch([{ body: { accountId: 'a', displayName: 'John Doe', emailAddress: 'john.doe@example.com' } }])
    expect(await jiraAccount(VALUES, 1000, fake.fetch)).toEqual({ login: 'john.doe@example.com', name: 'Jira · example', expiresAt: null })
    expect(fake.calls[0]!.url).toBe('https://example.atlassian.net/rest/api/3/myself')
  })

  it('falls back to the display name when the e-mail is hidden', async () => {
    expect(await jiraAccount(VALUES, 1000, fakeFetch([{ body: { accountId: 'a', displayName: 'John Doe', emailAddress: null } }]).fetch)).toMatchObject({ login: 'John Doe' })
  })

  it('a refusal on the site and through the gateway is a refusal, a failure is not', async () => {
    await expect(jiraAccount(VALUES, 1000, fakeFetch([{ status: 401 }, { body: { cloudId: 'cloud-1' } }, { status: 401 }]).fetch)).rejects.toBeInstanceOf(CredentialsRefused)
    await expect(jiraAccount(VALUES, 1000, fakeFetch([{ status: 401 }, { status: 404 }]).fetch)).rejects.toBeInstanceOf(CredentialsRefused)
    const failed = jiraAccount(VALUES, 1000, fakeFetch([{ status: 500, body: { errorMessages: ['Internal error'] } }]).fetch)
    await expect(failed).rejects.toThrow('jira: HTTP 500: Internal error')
  })

  it('refuses an address that is not https or has a path', async () => {
    await expect(jiraAccount({ ...VALUES, JIRA_URL: 'http://example.atlassian.net' }, 1000, fakeFetch([]).fetch)).rejects.toThrow()
    await expect(jiraAccount({ ...VALUES, JIRA_URL: 'https://example.atlassian.net/jira' }, 1000, fakeFetch([]).fetch)).rejects.toThrow()
  })

  it('lists the projects matching the query', async () => {
    const fake = fakeFetch([{ body: { accountId: 'a', displayName: 'John Doe' } }, { body: { values: [{ key: 'ABC', name: 'Alpha' }] } }])
    expect(await jiraProjects(VALUES, ' alp ', 1000, fake.fetch)).toEqual([{ key: 'ABC', name: 'Alpha' }])
    expect(fake.calls[1]!.url).toBe('https://example.atlassian.net/rest/api/3/project/search?maxResults=50&query=alp')
  })
})
