import { describe, expect, it } from 'vitest'
import { CredentialsRefused } from '../tracker/source.js'
import { fakeFetch } from './fixture.js'
import { gitlabAccount, gitlabProjects } from './profile.js'

describe('GitLab profile', () => {
  it('checks the user and the token expiry on the selected host', async () => {
    const fake = fakeFetch([{ body: { id: 9, username: 'example-user' } }, { body: { expires_at: '2026-11-01', scopes: ['api'] } }])
    expect(await gitlabAccount({ GITLAB_URL: 'https://gitlab.example.com/prefix/', GITLAB_TOKEN: 'example' }, 1000, fake.fetch)).toEqual({ login: 'example-user', name: 'GitLab · example-user', expiresAt: '2026-11-01T00:00:00.000Z' })
    expect(fake.calls.map((call) => call.url)).toEqual(['https://gitlab.example.com/prefix/api/v4/user', 'https://gitlab.example.com/prefix/api/v4/personal_access_tokens/self'])
    expect(fake.calls[0]!.headers.get('private-token')).toBe('example')
    expect(fake.calls[0]!.redirect).toBe('error')
  })

  it('refuses bad credentials and a read-only personal token', async () => {
    await expect(gitlabAccount({ GITLAB_TOKEN: 'example' }, 1000, fakeFetch([{ status: 401, body: {} }]).fetch)).rejects.toBeInstanceOf(CredentialsRefused)
    await expect(gitlabAccount({ GITLAB_TOKEN: 'example' }, 1000, fakeFetch([{ body: { username: 'example' } }, { body: { scopes: ['read_api'], expires_at: null } }]).fetch)).rejects.toBeInstanceOf(CredentialsRefused)
  })

  it('keeps a working user on older servers without the self-token endpoint', async () => {
    expect(await gitlabAccount({ GITLAB_TOKEN: 'example' }, 1000, fakeFetch([{ body: { username: 'example' } }, { status: 404, body: {} }]).fetch)).toMatchObject({ login: 'example', expiresAt: null })
  })

  it('lists accessible projects across pages and preserves subgroup paths', async () => {
    const fake = fakeFetch([{ body: [{ path_with_namespace: 'team/subgroup/app', name: 'App' }], next: '2' }, { body: [{ path_with_namespace: 'team/api', name: 'API' }] }])
    expect(await gitlabProjects({ GITLAB_TOKEN: 'example' }, 'team', 1000, fake.fetch)).toEqual([{ key: 'team/subgroup/app', name: 'App' }, { key: 'team/api', name: 'API' }])
    expect(fake.calls[1]!.url).toContain('page=2')
  })
})
