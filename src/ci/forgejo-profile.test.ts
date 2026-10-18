import { describe, expect, it } from 'vitest'
import { CredentialsRefused } from '../tracker/source.js'
import { FORGEJO_PROFILE, forgejoAccount, hostOf } from './forgejo-profile.js'

const VALUES = { FORGEJO_URL: 'git.example.com/', FORGEJO_TOKEN: 'example-token' }

describe('forgejoAccount', () => {
  it('signs in as the token\'s user and names the profile by the host', async () => {
    let asked = ''
    const fetch = (async (url: string, init: RequestInit) => {
      asked = `${url} ${(init.headers as Record<string, string>).authorization}`
      return new Response(JSON.stringify({ login: 'john-doe' }))
    }) as unknown as typeof globalThis.fetch
    expect(await forgejoAccount(VALUES, 5_000, fetch)).toEqual({ login: 'john-doe', name: 'Forgejo · git.example.com', expiresAt: null })
    expect(asked).toBe('https://git.example.com/api/v1/user token example-token')
  })

  it('a refused token or one without the right to read its user is a refusal, another failure is not', async () => {
    const reply = (status: number) => (async () => new Response('{}', { status })) as unknown as typeof fetch
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
