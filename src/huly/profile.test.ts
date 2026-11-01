import { afterEach, describe, expect, it, vi } from 'vitest'
import { hulyClient } from './client.js'
import { hulyAccount, refusedBy } from './profile.js'

const values = { HULY_URL: 'https://huly.example.com', HULY_WORKSPACE: 'example', HULY_TOKEN: 'token' }

function connectedAs(account: { primarySocialId: string; fullSocialIds?: { _id: string; type: string; value: string }[] }): void {
  const client = { getAccount: async () => account, findAll: async () => [], close: async () => undefined }
  vi.spyOn(hulyClient, 'require').mockReturnValue({ connect: async () => client, NodeWebSocketFactory: null })
}

describe('hulyAccount', () => {
  afterEach(() => vi.restoreAllMocks())

  it('a guest who cannot read their own person is named by the account\'s e-mail, not its huly id', async () => {
    connectedAs({
      primarySocialId: 'sid-1',
      fullSocialIds: [
        { _id: 'sid-1', type: 'huly', value: '00000000-0000-4000-8000-000000000001' },
        { _id: 'sid-2', type: 'email', value: 'john.doe@example.com' },
      ],
    })
    expect((await hulyAccount(values, 1000)).login).toBe('john.doe@example.com')
  })

  it('without an e-mail, the primary social id\'s value', async () => {
    connectedAs({ primarySocialId: 'sid-1', fullSocialIds: [{ _id: 'sid-1', type: 'huly', value: '00000000-0000-4000-8000-000000000001' }] })
    expect((await hulyAccount(values, 1000)).login).toBe('00000000-0000-4000-8000-000000000001')
  })
})

describe('refusedBy', () => {
  it('a platform status or the client\'s own login texts are a refusal', () => {
    expect(refusedBy(Object.assign(new Error('Unauthorized'), { status: { code: 'platform:status:Unauthorized' } }))).toBe(true)
    expect(refusedBy(new Error('Login failed'))).toBe(true)
    expect(refusedBy(new Error('Workspace not found'))).toBe(true)
    expect(refusedBy(new Error('Workspace example not found'))).toBe(true)
  })

  it('a network failure is not', () => {
    expect(refusedBy(new Error('fetch failed'))).toBe(false)
    expect(refusedBy(new Error('huly: no answer in 5000 ms'))).toBe(false)
    expect(refusedBy(null)).toBe(false)
  })
})
