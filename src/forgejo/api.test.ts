import { describe, expect, it } from 'vitest'
import { NoticeError } from '../notice/notice.js'
import { CredentialsRefused } from '../tracker/source.js'
import { ForgejoApi, ForgejoHttpError, ForgejoScopeError } from './api.js'
import { forgejoFetch, WEB, type Route } from './fixture.js'

function api(route: Route) {
  return new ForgejoApi(WEB, 'example-token', 1000, forgejoFetch({ 'GET /repos/example-org/app/issues': route }).fetch)
}

const read = (route: Route) => api(route).rest('/repos/example-org/app/issues')

describe('ForgejoApi', () => {
  it('names the scope a token lacks when Forgejo refuses it for that (BTN-788)', async () => {
    const error = await read({ status: 403, body: { message: 'token does not have at least one of required scope(s): [read:issue]' } }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ForgejoScopeError)
    expect(error).toBeInstanceOf(NoticeError)
    expect((error as NoticeError).notice).toEqual({ code: 'forgejo.scope', params: { scope: 'read:issue' } })
  })

  it('names every scope of the list', async () => {
    const error = await read({ status: 403, body: { message: 'token does not have at least one of required scope(s): [read:issue write:issue]' } }).catch((caught: unknown) => caught)
    expect((error as NoticeError).notice).toEqual({ code: 'forgejo.scope', params: { scope: 'read:issue, write:issue' } })
  })

  it('keeps a 401 a refused token and another 403 a plain HTTP error', async () => {
    await expect(read({ status: 401, body: { message: 'user does not exist' } })).rejects.toBeInstanceOf(CredentialsRefused)
    const other = await read({ status: 403, body: { message: 'must be an admin' } }).catch((caught: unknown) => caught)
    expect(other).toBeInstanceOf(ForgejoHttpError)
    expect(other).not.toBeInstanceOf(ForgejoScopeError)
  })
})
