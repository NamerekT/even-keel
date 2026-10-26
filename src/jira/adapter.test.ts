import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { sessionBase } from '../agent/env.js'
import { keysOf, substitute } from '../packages/keys.js'
import { ADAPTERS, trackerKeyRules } from '../tracker/adapters.js'
import { jira } from './adapter.js'

const VALUES = { JIRA_URL: 'https://example.atlassian.net', JIRA_EMAIL: 'john.doe@example.com', JIRA_TOKEN: 'example-token' }

describe('Jira adapter registration', () => {
  it('is off without values, refuses a part of them and links issues on the site', () => {
    expect(ADAPTERS.jira).toBe(jira)
    expect(jira.setup({}, {})).toBeUndefined()
    expect(() => jira.setup({ JIRA_URL: VALUES.JIRA_URL }, {})).toThrow()
    expect(() => jira.setup({ ...VALUES, JIRA_URL: 'example.atlassian.net' }, {})).toThrow()
    const setup = jira.setup(VALUES, { app: { key: 'ABC' } })!
    expect(setup.issueUrl('app')).toBe('https://example.atlassian.net/browse/{id}')
    expect(setup.projectUrl!('app')).toBe('https://example.atlassian.net/browse/ABC')
    expect(setup.projectUrl!('other')).toBeNull()
  })

  it('keeps the profile out of the sessions', () => {
    expect(sessionBase({ ...VALUES, PATH: 'bin' })).toEqual({ PATH: 'bin' })
  })

  it('hands the gateway the Basic header of the e-mail and the token, and names what is missing', () => {
    const entry = JSON.parse(readFileSync(new URL('../../plugins/jira/.mcp.json', import.meta.url), 'utf8')).mcpServers.jira
    const keys = keysOf('jira', entry, trackerKeyRules(), VALUES)
    expect(keys.missing).toEqual([])
    expect(keys.names).toEqual(['JIRA_EMAIL', 'JIRA_TOKEN'])
    const header = `Basic ${Buffer.from('john.doe@example.com:example-token').toString('base64')}`
    expect(substitute(entry, keys.values)).toMatchObject({ headers: { Authorization: header } })
    expect(keysOf('jira', entry, trackerKeyRules(), { JIRA_EMAIL: VALUES.JIRA_EMAIL }).missing).toEqual(['JIRA_TOKEN'])
  })
})
