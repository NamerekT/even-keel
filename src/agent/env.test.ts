import { describe, expect, it } from 'vitest'
import { claudeEnv } from '../claude/adapter.js'
import { sessionBase, sessionSecrets, settingsSecrets } from './env.js'

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

describe('sessionSecrets', () => {
  it('names the trackers, the CIs and the packages keys', () => {
    const names = sessionSecrets(['EXAMPLE_KEY'])
    expect(names).toEqual(expect.arrayContaining(['HULY_PASSWORD', 'GITLAB_TOKEN', 'GITLAB_URL', 'FORGEJO_TOKEN', 'EXAMPLE_KEY']))
    expect(names).not.toContain('PATH')
  })
})

describe('settingsSecrets', () => {
  it('finds the names the env of a settings file sets', () => {
    const settings = { theme: 'dark', env: { GITLAB_TOKEN: 'example', PATH: '/bin', HULY_URL: 'https://huly.example.com' } }
    expect(settingsSecrets(settings, sessionSecrets()).sort()).toEqual(['GITLAB_TOKEN', 'HULY_URL'])
  })

  it('finds nothing without an env', () => {
    expect(settingsSecrets(undefined, sessionSecrets())).toEqual([])
    expect(settingsSecrets({ env: 'broken' }, sessionSecrets())).toEqual([])
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

  it('turns the auto-updater off only for sessions on the checked copy', () => {
    const home = { key: 'a', dir: 'root/a', global: false, agent: 'claude' }
    expect(claudeEnv(base, home, true).DISABLE_AUTOUPDATER).toBe('1')
    expect(claudeEnv(base, home).DISABLE_AUTOUPDATER).toBeUndefined()
  })
})
