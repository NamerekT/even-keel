import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { windowOf } from './adapter.js'
import { keyOf, keyVendor, openCodeEnv, parseAuth, writeKey } from './home.js'

describe('parseAuth', () => {
  it('takes a folder with no credential as signed in for the free models', () => {
    expect(parseAuth(undefined)).toEqual({ loggedIn: true, authMethod: 'none', email: null, orgName: null, subscriptionType: null })
  })

  it('tells an API key from a sign-in and lists the providers', () => {
    expect(parseAuth(JSON.stringify({ anthropic: { type: 'api', key: 'k' } }))).toMatchObject({ authMethod: 'api_key', subscriptionType: 'anthropic' })
    const both = parseAuth(JSON.stringify({ openai: { type: 'oauth', access: 'a' }, anthropic: { type: 'api', key: 'k' } }))
    expect(both).toMatchObject({ authMethod: 'oauth', subscriptionType: 'openai, anthropic' })
  })
})

describe('the key of an OpenCode folder', () => {
  it('goes under the provider its start names', () => {
    expect(keyVendor('sk-ant-api03-FAKE')).toBe('anthropic')
    expect(keyVendor('sk-proj-FAKE')).toBe('openai')
  })

  it('is written the way opencode providers login writes it and read back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'even-keel-opencode-'))
    try {
      expect(keyOf(dir)).toBeNull()
      writeKey(dir, 'sk-proj-fake.example.com.0000')
      expect(JSON.parse(readFileSync(join(dir, 'data', 'opencode', 'auth.json'), 'utf8'))).toEqual({
        openai: { type: 'api', key: 'sk-proj-fake.example.com.0000' },
      })
      expect(readFileSync(join(dir, 'config', 'opencode', 'AGENTS.md'), 'utf8')).toBe('')
      expect(keyOf(dir)).toBe('sk-proj-fake.example.com.0000')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('openCodeEnv', () => {
  it('points the four XDG folders into the account and turns off self-update and the outside skills', () => {
    const env = openCodeEnv({ PATH: '/bin' }, '/accounts/zen')
    expect(env).toMatchObject({
      PATH: '/bin',
      XDG_DATA_HOME: join('/accounts/zen', 'data'),
      XDG_CONFIG_HOME: join('/accounts/zen', 'config'),
      XDG_STATE_HOME: join('/accounts/zen', 'state'),
      XDG_CACHE_HOME: join('/accounts/zen', 'cache'),
      OPENCODE_DISABLE_AUTOUPDATE: '1',
      OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
      OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1',
    })
    expect(env.OPENCODE_DISABLE_CLAUDE_CODE).toBeUndefined()
  })
})

describe('windowOf', () => {
  const catalogue = JSON.stringify({ opencode: { models: { 'big-pickle': { limit: { context: 200_000 } } } } })

  it("reads a model's window from OpenCode's catalogue", () => {
    expect(windowOf(catalogue, 'opencode/big-pickle')).toBe(200_000)
    expect(windowOf(catalogue, 'opencode/unknown')).toBeNull()
    expect(windowOf(catalogue, 'big-pickle')).toBeNull()
    expect(windowOf('{', 'opencode/big-pickle')).toBeNull()
  })
})
