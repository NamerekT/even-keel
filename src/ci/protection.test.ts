import { describe, expect, it } from 'vitest'
import { branchProtection } from './protection.js'

const target = { kind: 'github' as const, remote: 'upstream', web: 'https://github.com', owner: 'example', repo: 'demo' }
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
describe('remote branch protection', () => {
  it('counts active rulesets and classic protection together', async () => {
    const fetcher = async (url: string | URL | Request) => String(url).includes('/rules/branches/')
      ? response([{ type: 'deletion' }])
      : String(url).endsWith('/protection') ? response({ allow_force_pushes: { enabled: false }, allow_deletions: { enabled: true }, enforce_admins: { enabled: true } }) : response({ protected: true })
    expect((await branchProtection(target, 'release/next', 'fake', fetcher as typeof fetch)).status).toBe('protected')
  })
  it('reports a branch without protection and keeps permission failures unknown', async () => {
    const open = async (url: string | URL | Request) => String(url).includes('/rules/branches/') ? response([]) : String(url).endsWith('/protection') ? response({}, 404) : response({ protected: false })
    expect((await branchProtection(target, 'develop', null, open as typeof fetch)).status).toBe('unprotected')
    expect((await branchProtection(target, 'develop', 'fake', (async () => response({}, 403)) as typeof fetch)).status).toBe('unknown')
  })
  it('matches a Forgejo wildcard rule but gives an exact rule precedence', async () => {
    const forge = { ...target, kind: 'forgejo' as const, web: 'https://forge.example.com' }
    const fetcher = (async () => response([
      { rule_name: 'release/**', enable_force_push: true, apply_to_admins: true },
      { rule_name: 'release/next', enable_force_push: false, apply_to_admins: true },
    ])) as typeof fetch
    const result = await branchProtection(forge, 'release/next', 'fake', fetcher)
    expect(result.status).toBe('protected')
    expect(result.bypass).toBe(false)
  })

  it('keeps an incomplete Forgejo response unknown and reports administrator bypasses', async () => {
    const forge = { ...target, kind: 'forgejo' as const }
    const incomplete = (async () => response([{ rule_name: 'develop' }])) as typeof fetch
    expect((await branchProtection(forge, 'develop', 'fake', incomplete)).status).toBe('unknown')
    const bypass = (async () => response([{ rule_name: 'develop', enable_force_push: false, apply_to_admins: false }])) as typeof fetch
    expect(await branchProtection(forge, 'develop', 'fake', bypass)).toMatchObject({ status: 'protected', bypass: true })
  })
})
