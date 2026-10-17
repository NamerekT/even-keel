import { describe, expect, it } from 'vitest'
import { claudeEnv } from '../claude/adapter.js'
import { sessionBase } from './env.js'

const env = {
  PATH: '/bin',
  HULY_URL: 'https://huly.example.com',
  HULY_WORKSPACE: 'ws',
  HULY_EMAIL: 'john@example.com',
  HULY_PASSWORD: 'secret',
}

describe('sessionBase', () => {
  it('drops the Huly credentials', () => {
    const result = sessionBase(env)
    expect(Object.keys(result).filter((name) => name.startsWith('HULY_'))).toEqual([])
    expect(result.PATH).toBe('/bin')
  })

  it('drops the CI token', () => {
    expect(sessionBase({ ...env, FORGEJO_TOKEN: 'fake-token' }).FORGEJO_TOKEN).toBeUndefined()
  })
})

describe('claudeEnv', () => {
  const base = sessionBase(env)

  it('leaves the global account on the default config dir', () => {
    expect(claudeEnv(base, { key: 'global', dir: 'home/.claude', global: true, agent: 'claude' }).CLAUDE_CONFIG_DIR).toBeUndefined()
  })

  it('sets the config dir for another account', () => {
    const result = claudeEnv(base, { key: 'a', dir: 'root/a', global: false, agent: 'claude' })
    expect(Object.keys(result).filter((name) => name.startsWith('HULY_'))).toEqual([])
    expect(result.PATH).toBe('/bin')
    expect(result.CLAUDE_CONFIG_DIR).toBe('root/a')
  })
})
