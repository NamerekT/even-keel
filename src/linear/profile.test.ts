import { describe, expect, it } from 'vitest'
import { CredentialsRefused } from '../tracker/source.js'
import { linearAccount, linearProjects } from './profile.js'

const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

const VALUES = { LINEAR_TOKEN: 'lin_api_example' }

describe('linearAccount', () => {
  it('names the profile by the workspace and signs in as the e-mail', async () => {
    const fetch = reply({ data: { viewer: { name: 'John Doe', email: 'john@example.com' }, organization: { name: 'Example' } } })
    expect(await linearAccount(VALUES, 5_000, fetch)).toEqual({ login: 'john@example.com', name: 'Linear · Example', expiresAt: null })
  })

  it('an authentication error is a refusal, another failure is not', async () => {
    const refused = reply({ errors: [{ message: 'Authentication required', extensions: { code: 'AUTHENTICATION_ERROR' } }] }, 400)
    await expect(linearAccount(VALUES, 5_000, refused)).rejects.toBeInstanceOf(CredentialsRefused)
    await expect(linearAccount(VALUES, 5_000, reply({}, 401))).rejects.toBeInstanceOf(CredentialsRefused)
    const failed = linearAccount(VALUES, 5_000, reply({ errors: [{ message: 'Internal error' }] }, 500))
    await expect(failed).rejects.toThrow('linear: HTTP 500: Internal error')
    await expect(failed).rejects.not.toBeInstanceOf(CredentialsRefused)
  })
})

describe('linearProjects', () => {
  const TEAMS = {
    data: {
      teams: {
        nodes: [
          { key: 'ENG', name: 'Engineering', projects: { nodes: [{ name: 'Web app' }, { name: 'Billing' }] } },
          { key: 'OPS', name: 'Operations', projects: { nodes: [] } },
        ],
      },
    },
  }

  it('lists the teams and their projects', async () => {
    expect(await linearProjects(VALUES, '', 5_000, reply(TEAMS))).toEqual([
      { key: 'ENG', name: 'Engineering' },
      { key: 'ENG', name: 'Web app', within: 'Web app' },
      { key: 'ENG', name: 'Billing', within: 'Billing' },
      { key: 'OPS', name: 'Operations' },
    ])
  })

  it('keeps the entries whose key or name has the query', async () => {
    expect(await linearProjects(VALUES, 'web', 5_000, reply(TEAMS))).toEqual([{ key: 'ENG', name: 'Web app', within: 'Web app' }])
    expect(await linearProjects(VALUES, 'ops', 5_000, reply(TEAMS))).toEqual([{ key: 'OPS', name: 'Operations' }])
  })
})
