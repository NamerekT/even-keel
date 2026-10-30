import { describe, expect, it } from 'vitest'
import { CredentialsRefused } from '../tracker/source.js'
import { fakeFetch } from './fixture.js'
import { jiraAccount, jiraProjects } from './profile.js'

const VALUES = { JIRA_URL: 'https://example.atlassian.net/', JIRA_EMAIL: 'john.doe@example.com', JIRA_TOKEN: 'example-token' }

describe('Jira profile', () => {
  it('names the profile by the site, signs in as the e-mail and names the person for the MCP grant\'s comparison', async () => {
    const fake = fakeFetch([{ body: { accountId: 'a', displayName: 'John Doe', emailAddress: 'john.doe@example.com' } }])
    expect(await jiraAccount(VALUES, 1000, fake.fetch)).toEqual({ login: 'john.doe@example.com', name: 'Jira · example', expiresAt: null, user: { id: 'a', name: 'John Doe' } })
    expect(fake.calls[0]!.url).toBe('https://example.atlassian.net/rest/api/3/myself')
  })

  it('falls back to the display name when the e-mail is hidden', async () => {
    expect(await jiraAccount(VALUES, 1000, fakeFetch([{ body: { accountId: 'a', displayName: 'John Doe', emailAddress: null } }]).fetch)).toMatchObject({ login: 'John Doe' })
  })

  it('checks the MCP token with a tool call and accepts only the profile site', async () => {
    const fake = fakeFetch([
      { body: { accountId: 'a', displayName: 'John Doe' } },
      { body: { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'test', version: '1' } } } },
      { status: 204 },
      { body: { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: JSON.stringify([{ id: 'cloud-1', url: VALUES.JIRA_URL, scopes: ['read-write'] }]) }] } } },
    ])
    await expect(jiraAccount({ ...VALUES, JIRA_MCP_TOKEN: 'mcp-token' }, 1000, fake.fetch)).resolves.toMatchObject({ name: 'Jira · example' })
    expect(fake.calls[0]!.headers.get('authorization')).toBe(`Basic ${Buffer.from('john.doe@example.com:example-token').toString('base64')}`)
    expect(fake.calls.slice(1).every((call) => call.headers.get('authorization') === `Basic ${Buffer.from('john.doe@example.com:mcp-token').toString('base64')}`)).toBe(true)
    expect(fake.calls[3]).toMatchObject({ url: 'https://mcp.atlassian.com/v2/mcp', body: { method: 'tools/call', params: { name: 'getAccessibleAtlassianResources', arguments: {} } } })
    expect(fake.remaining()).toBe(0)
  })

  it.each([[[]], [[{ id: 'cloud-2', url: 'https://other.atlassian.net' }]]])('explains how to replace an MCP token without access to the site: %j', async (resources) => {
    const fake = fakeFetch([
      { body: { accountId: 'a', displayName: 'John Doe' } },
      { body: { jsonrpc: '2.0', id: 1, result: {} } },
      { status: 204 },
      { body: { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: JSON.stringify(resources) }] } } },
    ])
    await expect(jiraAccount({ ...VALUES, JIRA_MCP_TOKEN: 'mcp-token' }, 1000, fake.fetch)).rejects.toMatchObject({ notice: { code: 'jira.mcpSite' } })
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
