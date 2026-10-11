import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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
