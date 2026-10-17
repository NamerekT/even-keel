import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AccountHomes } from './homes.js'

const env = {
  PATH: '/bin',
  HULY_URL: 'https://huly.example.com',
  HULY_WORKSPACE: 'ws',
  HULY_EMAIL: 'john@example.com',
  HULY_PASSWORD: 'secret',
}

describe('AccountHomes.envOf', () => {
  it('drops the Huly credentials for the global account', () => {
    const homes = new AccountHomes(env, 'root')
    const result = homes.envOf(homes.global)
    expect(Object.keys(result).filter((name) => name.startsWith('HULY_'))).toEqual([])
    expect(result.PATH).toBe('/bin')
  })

  it('drops the CI token', () => {
    const homes = new AccountHomes({ ...env, FORGEJO_TOKEN: 'fake-token' }, 'root')
    expect(homes.envOf(homes.global).FORGEJO_TOKEN).toBeUndefined()
  })

  it('drops the Huly credentials and sets the config dir for another account', () => {
    const homes = new AccountHomes(env, 'root')
    const result = homes.envOf({ key: 'a', dir: 'root/a', global: false })
    expect(Object.keys(result).filter((name) => name.startsWith('HULY_'))).toEqual([])
    expect(result.PATH).toBe('/bin')
    expect(result.CLAUDE_CONFIG_DIR).toBe('root/a')
  })
})

describe('AccountHomes.addApiKey', () => {
  const key = 'sk-ant-api03-FAKE0000000000000000000000000000-example'

  it("makes a folder whose settings carry the key and whose .claude.json has it approved by its last 20 characters", () => {
    const root = mkdtempSync(join(tmpdir(), 'even-keel-homes-'))
    try {
      const home = new AccountHomes(env, root).addApiKey('Work API', `  ${key}\n`)
      expect(home).toEqual({ key: 'work-api', dir: join(root, 'work-api'), global: false })
      expect(JSON.parse(readFileSync(join(home.dir, 'settings.json'), 'utf8'))).toEqual({ env: { ANTHROPIC_API_KEY: key } })
      const config = JSON.parse(readFileSync(join(home.dir, '.claude.json'), 'utf8'))
      expect(config.customApiKeyResponses).toEqual({ approved: [key.slice(-20)], rejected: [] })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('names the folder "api" without a name and never takes a folder already there', () => {
    const root = mkdtempSync(join(tmpdir(), 'even-keel-homes-'))
    try {
      mkdirSync(join(root, 'api'))
      expect(new AccountHomes(env, root).addApiKey('', key).key).toBe('api-2')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses a key with spaces inside or too short to approve', () => {
    const homes = new AccountHomes(env, 'root')
    expect(() => homes.addApiKey('api', 'sk-ant short key')).toThrow()
    expect(() => homes.addApiKey('api', 'sk-ant-short')).toThrow()
  })
})

describe('AccountHomes.list', () => {
  it('skips the lock folders the CLI keeps next to an account folder while it refreshes the token', () => {
    const root = mkdtempSync(join(tmpdir(), 'even-keel-homes-'))
    try {
      for (const name of ['john', 'john.lock', '.pending-1', 'global']) mkdirSync(join(root, name))
      const homes = new AccountHomes(env, root)
      expect(homes.list().map((home) => home.key)).toEqual(['global', 'john'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
