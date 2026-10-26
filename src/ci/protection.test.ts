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
  it('reads each active ruleset once and clears the bypass warning when its actors are empty', async () => {
    const calls: string[] = []
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('/rules/branches/')) return response([{ type: 'non_fast_forward', ruleset_id: 42 }, { type: 'deletion', ruleset_id: 42 }])
      if (url.endsWith('/rulesets/42')) return response({ bypass_actors: [] })
      return url.endsWith('/protection') ? response({}, 404) : response({ protected: true })
    }) as typeof fetch
    expect(await branchProtection(target, 'release/next', 'fake', fetcher)).toMatchObject({ status: 'protected', bypass: false })
    expect(calls.filter(url => url.includes('/rulesets/'))).toEqual(['https://api.github.com/repos/example/demo/rulesets/42'])
  })

  it.each(['actors', 'hidden', 'denied', 'network', 'second'])('keeps possible bypasses for %s ruleset details', async (scenario) => {
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/rules/branches/')) return response([{ type: 'non_fast_forward', ruleset_id: 42 }, { type: 'deletion', ruleset_id: scenario === 'second' ? 43 : 42 }])
      if (url.includes('/rulesets/')) {
        if (scenario === 'network') throw new Error('offline')
        if (scenario === 'denied') return response({}, 403)
        if (scenario === 'hidden') return response({})
        return response({ bypass_actors: scenario === 'actors' || url.endsWith('/43') ? [{ actor_type: 'Team' }] : [] })
      }
      return url.endsWith('/protection') ? response({}, 404) : response({ protected: true })
    }) as typeof fetch
    expect(await branchProtection(target, 'develop', 'fake', fetcher)).toMatchObject({ status: 'protected', bypass: true })
  })

  it.each([true, false])('still accounts for classic administrator enforcement: %s', async (enforced) => {
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/rules/branches/')) return response([{ type: 'deletion', ruleset_id: 42 }])
      if (url.includes('/rulesets/')) return response({ bypass_actors: [] })
      return url.endsWith('/protection') ? response({ allow_force_pushes: { enabled: false }, enforce_admins: { enabled: enforced } }) : response({ protected: true })
    }) as typeof fetch
    expect(await branchProtection(target, 'develop', 'fake', fetcher)).toMatchObject({ status: 'protected', bypass: !enforced })
  })

  it.each([true, false])('recognizes legacy Forgejo rules with push enabled: %s', async (enabled) => {
    const forge = { ...target, kind: 'forgejo' as const }
    const fetcher = (async () => response([{ rule_name: 'develop', enable_push: enabled, apply_to_admins: true }])) as typeof fetch
    expect(await branchProtection(forge, 'develop', 'fake', fetcher)).toMatchObject({ status: 'protected', bypass: false })
  })

  it('keeps a ruleset without an id conservative', async () => {
    const fetcher = (async (input: string | URL | Request) => String(input).includes('/rules/branches/')
      ? response([{ type: 'non_fast_forward' }, { type: 'deletion' }])
      : String(input).endsWith('/protection') ? response({}, 404) : response({ protected: true })) as typeof fetch
    expect(await branchProtection(target, 'develop', 'fake', fetcher)).toMatchObject({ status: 'protected', bypass: true })
  })

  it.each([403, 404])('keeps a Forgejo permission failure unknown: %s', async (status) => {
    const forge = { ...target, kind: 'forgejo' as const }
    expect((await branchProtection(forge, 'develop', 'fake', (async () => response({}, status)) as typeof fetch)).status).toBe('unknown')
  })

  it('does not treat a malformed force-push switch as a legacy Forgejo rule', async () => {
    const forge = { ...target, kind: 'forgejo' as const }
    const fetcher = (async () => response([{ rule_name: 'develop', enable_push: true, enable_force_push: null, apply_to_admins: true }])) as typeof fetch
    expect((await branchProtection(forge, 'develop', 'fake', fetcher)).status).toBe('unknown')
  })

  it('keeps administrator bypasses visible on legacy Forgejo', async () => {
    const forge = { ...target, kind: 'forgejo' as const }
    const fetcher = (async () => response([{ rule_name: 'develop', enable_push: true, apply_to_admins: false }])) as typeof fetch
    expect(await branchProtection(forge, 'develop', 'fake', fetcher)).toMatchObject({ status: 'protected', bypass: true })
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
