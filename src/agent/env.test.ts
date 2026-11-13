import { describe, expect, it } from 'vitest'
import { claudeEnv } from '../claude/adapter.js'
import { sessionBase, sessionEnv, sessionSecrets, settingsSecrets } from './env.js'

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

  it("drops Even Keel's own secrets even when set from outside", () => {
    const result = sessionBase({ ...env, EVEN_KEEL_TOKEN: 'x', TALLY_LLM_KEY: 'y', TALLY_WRITER_PASSWORD: 'z', EVEN_KEEL_BADGE_SECRET: 'w' })
    expect(Object.keys(result).sort()).toEqual(['PATH'])
  })

  it("drops the adapters' placeholder names the gateway also reads a key under", () => {
    const result = sessionBase({ ...env, GITHUB_PERSONAL_ACCESS_TOKEN: 'x', LINEAR_API_KEY: 'y', JIRA_BASIC_AUTH: 'z', GITEA_ACCESS_TOKEN: 'w' })
    expect(Object.keys(result).sort()).toEqual(['PATH'])
  })

  it('drops whatever came from the .env file', () => {
    const result = sessionBase({ ...env, EVEN_KEEL_PORT: '4800', EXAMPLE_PROXY: 'http://proxy.example.com' }, [], ['EVEN_KEEL_PORT', 'EXAMPLE_PROXY'])
    expect(Object.keys(result).sort()).toEqual(['PATH'])
  })
})

describe('sessionEnv', () => {
  it("gives the packages' hooks the service's own address over an inherited one", () => {
    const result = sessionEnv({ ...env, EVEN_KEEL_URL: 'http://127.0.0.1:4747' }, ['EXAMPLE_KEY'], 'http://127.0.0.1:5000')
    expect(result.EVEN_KEEL_URL).toBe('http://127.0.0.1:5000')
    expect(result.HULY_PASSWORD).toBeUndefined()
    expect(result.PATH).toBe('/bin')
  })
})

describe('sessionSecrets', () => {
  it('names the trackers, the CIs and the packages keys', () => {
    const names = sessionSecrets(['EXAMPLE_KEY'])
    expect(names).toEqual(expect.arrayContaining(['HULY_PASSWORD', 'GITLAB_TOKEN', 'GITLAB_URL', 'FORGEJO_TOKEN', 'EXAMPLE_KEY']))
    expect(names).not.toContain('PATH')
  })

  it("names the adapters' placeholders and Even Keel's own secrets, not its plain settings", () => {
    const names = sessionSecrets()
    expect(names).toEqual(expect.arrayContaining(['GITHUB_PERSONAL_ACCESS_TOKEN', 'LINEAR_API_KEY', 'GITLAB_PERSONAL_ACCESS_TOKEN', 'JIRA_BASIC_AUTH', 'EVEN_KEEL_TOKEN', 'TALLY_LLM_KEY', 'EVEN_KEEL_BADGE_SECRET']))
    expect(names).not.toContain('TALLY_DB_HOST')
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
