import { describe, expect, it } from 'vitest'
import { CredentialsRefused } from '../tracker/source.js'
import { expirationOf, githubAccount, githubProjects } from './profile.js'

type Reply = { status?: number; body: unknown; headers?: Record<string, string> }

function fakeFetch(replies: Record<string, Reply>) {
  const urls: string[] = []
  const fetch = async (url: string | URL | Request): Promise<Response> => {
    urls.push(String(url))
    const path = new URL(String(url)).pathname
    const reply = replies[path]
    if (reply === undefined) throw new Error(`unexpected call: ${String(url)}`)
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: reply.headers })
  }
  return { fetch: fetch as typeof globalThis.fetch, urls }
}

const VALUES = { GITHUB_TOKEN: 'github_pat_example' }
const repo = (owner: string, name: string) => ({ full_name: `${owner}/${name}`, name, owner: { login: owner } })

describe('githubAccount', () => {
  it('names a token that sees one owner by the owner, and reads the expiration header', async () => {
    const { fetch } = fakeFetch({
      '/user': { body: { login: 'octocat' }, headers: { 'github-authentication-token-expiration': '2026-11-01 12:00:00 UTC' } },
      '/user/repos': { body: [repo('octo-org', 'web'), repo('octo-org', 'api')] },
    })
    expect(await githubAccount(VALUES, 5_000, fetch)).toEqual({ login: 'octocat', name: 'GitHub · octo-org', expiresAt: '2026-11-01T12:00:00.000Z' })
  })

  it('names a token of several owners by its login; no header, no expiration', async () => {
    const { fetch } = fakeFetch({
      '/user': { body: { login: 'octocat' } },
      '/user/repos': { body: [repo('octo-org', 'web'), repo('octocat', 'dotfiles')] },
    })
    expect(await githubAccount(VALUES, 5_000, fetch)).toEqual({ login: 'octocat', name: 'GitHub · octocat', expiresAt: null })
  })

  it('a 401 is a refusal, another failure is not', async () => {
    await expect(githubAccount(VALUES, 5_000, fakeFetch({ '/user': { status: 401, body: { message: 'Bad credentials' } } }).fetch)).rejects.toBeInstanceOf(CredentialsRefused)
    const failed = githubAccount(VALUES, 5_000, fakeFetch({ '/user': { status: 503, body: { message: 'Unavailable' } } }).fetch)
    await expect(failed).rejects.toThrow('github: HTTP 503: Unavailable')
    await expect(failed).rejects.not.toBeInstanceOf(CredentialsRefused)
  })
})

describe('githubProjects', () => {
  it('lists the repositories whose full name has the query, as owner/name', async () => {
    const { fetch } = fakeFetch({ '/user/repos': { body: [repo('octo-org', 'web'), repo('octo-org', 'api'), repo('octocat', 'Website')] } })
    expect(await githubProjects(VALUES, 'WEB', 5_000, fetch)).toEqual([
      { key: 'octo-org/web', name: 'web' },
      { key: 'octocat/Website', name: 'Website' },
    ])
  })
})

describe('expirationOf', () => {
  it('reads UTC and offsets, and nothing else', () => {
    expect(expirationOf('2026-11-01 12:00:00 +0200')).toBe('2026-11-01T10:00:00.000Z')
    expect(expirationOf('2026-11-01 12:00:00 -05:00')).toBe('2026-11-01T17:00:00.000Z')
    expect(expirationOf(null)).toBeNull()
    expect(expirationOf('soon')).toBeNull()
  })
})
