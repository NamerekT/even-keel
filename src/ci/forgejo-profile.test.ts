import { describe, expect, it } from 'vitest'
import { CredentialsRefused } from '../tracker/source.js'
import { FORGEJO_PROFILE, forgejoAccount, hostOf } from './forgejo-profile.js'

const VALUES = { FORGEJO_URL: 'git.example.com/', FORGEJO_TOKEN: 'example-token' }

describe('forgejoAccount', () => {
  it('recognizes GitLab on its public or own host and points to the GitLab profile', async () => {
    const fetchImpl = (async (url: string) => url.includes('/api/v4/')
      ? Response.json({ version: '18.5.0', revision: 'abc123' })
      : new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } })) as typeof fetch
    await expect(forgejoAccount(VALUES, 1_000, fetchImpl)).rejects.toThrow('GitLab profile')
    await expect(forgejoAccount({ ...VALUES, FORGEJO_URL: 'https://gitlab.com' }, 1_000, fetchImpl)).rejects.toThrow('GitLab profile')
  })
  it('signs in as the token\'s user and names the profile by the host', async () => {
    const asked: string[] = []
    const fetch = (async (url: string, init: RequestInit) => {
      asked.push(`${url} ${(init.headers as Record<string, string>).authorization}`)
      return Response.json(url.endsWith('/version') ? { version: '13.0.2+gitea-1.22.0' } : { login: 'john-doe' })
    }) as unknown as typeof globalThis.fetch
    expect(await forgejoAccount(VALUES, 5_000, fetch)).toEqual({ login: 'john-doe', name: 'Forgejo · git.example.com', expiresAt: null })
    expect(asked).toEqual(['https://git.example.com/api/v1/version token example-token', 'https://git.example.com/api/v1/user token example-token'])
  })

  it('says a server that does not answer its version as Forgejo or Gitea does is not Forgejo', async () => {
    const html = { headers: { 'content-type': 'text/html; charset=UTF-8' } }
    const replies = [
      Response.json({ message: '404 Not Found' }, { status: 404 }),
      new Response('<html></html>', html),
      new Response('<html>Just a moment...</html>', { ...html, status: 403 }),
      Response.json({ name: 'GitLab' }),
    ]
    for (const reply of replies) {
      const fetch = (async () => reply) as unknown as typeof globalThis.fetch
      await expect(forgejoAccount(VALUES, 5_000, fetch)).rejects.toThrow('git.example.com is not a Forgejo or Gitea server')
    }
  })

  it('a refused token or one without the right to read its user is a refusal, another failure is not', async () => {
    const reply = (status: number) => (async () => Response.json({}, { status })) as unknown as typeof fetch
    await expect(forgejoAccount(VALUES, 5_000, reply(401))).rejects.toBeInstanceOf(CredentialsRefused)
    await expect(forgejoAccount(VALUES, 5_000, reply(403))).rejects.toThrow('read:user')
    const failed = forgejoAccount(VALUES, 5_000, reply(502))
    await expect(failed).rejects.toThrow('forgejo: HTTP 502')
    await expect(failed).rejects.not.toBeInstanceOf(CredentialsRefused)
  })
})

describe('FORGEJO_PROFILE', () => {
  it('makes a profile of the address and the token together', () => {
    expect(FORGEJO_PROFILE.complete({})).toBe(false)
    expect(FORGEJO_PROFILE.complete(VALUES)).toBe(true)
    expect(() => FORGEJO_PROFILE.complete({ FORGEJO_TOKEN: 'example-token' })).toThrow('FORGEJO_URL')
    expect(() => FORGEJO_PROFILE.complete({ ...VALUES, FORGEJO_URL: 'http://' })).toThrow('FORGEJO_URL')
    expect(FORGEJO_PROFILE.profileName(VALUES, null)).toBe('Forgejo · git.example.com')
    expect(FORGEJO_PROFILE.projects).toBeUndefined()
  })
})

describe('hostOf', () => {
  it('reads the host of an address with or without its scheme, lowercase', () => {
    expect(hostOf('https://Git.Example.com:3000/sub/')).toBe('git.example.com')
    expect(hostOf('git.example.com')).toBe('git.example.com')
    expect(hostOf('')).toBeNull()
  })
})
