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

  it('drops the Huly credentials and sets the config dir for another account', () => {
    const homes = new AccountHomes(env, 'root')
    const result = homes.envOf({ key: 'a', dir: 'root/a', global: false })
    expect(Object.keys(result).filter((name) => name.startsWith('HULY_'))).toEqual([])
    expect(result.PATH).toBe('/bin')
    expect(result.CLAUDE_CONFIG_DIR).toBe('root/a')
  })
})
