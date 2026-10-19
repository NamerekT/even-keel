import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isSecret, secretCatalog, type SecretSpec } from './catalog.js'
import { Secrets, withSessionEnv } from './service.js'

/** The catalog has no variable the sessions read since the trackers' went into profiles; the place is kept for one. */
const sessionSpec = (name: string): SecretSpec => ({ name, secret: isSecret(name), places: ['env', 'sessions'], readers: { tally: false, page: false } })
const catalog = [sessionSpec('HULY_URL'), sessionSpec('HULY_PASSWORD'), ...secretCatalog()]

describe('withSessionEnv', () => {
  it('sets one key of env and keeps every other key of the file', () => {
    const text = JSON.stringify({ model: 'opus', env: { OTHER: '1' }, hooks: { Stop: [] } })
    expect(JSON.parse(withSessionEnv(text, 'HULY_PASSWORD', 'secret'))).toEqual({ model: 'opus', env: { OTHER: '1', HULY_PASSWORD: 'secret' }, hooks: { Stop: [] } })
    expect(JSON.parse(withSessionEnv('', 'HULY_PASSWORD', 'secret'))).toEqual({ env: { HULY_PASSWORD: 'secret' } })
  })

  it('removes the key, and env with it once empty', () => {
    expect(JSON.parse(withSessionEnv(JSON.stringify({ env: { A: '1', B: '2' } }), 'A', null))).toEqual({ env: { B: '2' } })
    expect(JSON.parse(withSessionEnv(JSON.stringify({ model: 'opus', env: { A: '1' } }), 'A', null))).toEqual({ model: 'opus' })
  })

  it('refuses a file that is not a JSON object, rather than writing over it', () => {
    expect(() => withSessionEnv('{ // comment\n}', 'A', '1')).toThrow()
    expect(() => withSessionEnv('{"env": "x"}', 'A', '1')).toThrow()
  })
})

describe('Secrets', () => {
  let dir: string
  let envFile: string
  let settingsFile: string
  let env: NodeJS.ProcessEnv
  let applied: number
  let expired: number
  let host: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'even-keel-secrets-'))
    envFile = join(dir, '.env')
    settingsFile = join(dir, 'settings.json')
    env = {}
    applied = 0
    expired = 0
    host = '127.0.0.1'
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const open = (outer: string[] = []) =>
    new Secrets({
      catalog,
      envFile,
      settingsFile: () => settingsFile,
      env,
      outer: (name) => outer.includes(name),
      // The service's EnvFile puts the new file into the environment.
      applied: () => {
        applied++
        for (const line of readFileSync(envFile, 'utf8').split('\n')) {
          const [name, value] = line.split('=')
          if (name) env[name] = value
        }
      },
      host: () => host,
      expired: () => expired++,
      sessionsPending: () => false,
      onChange: () => {},
    })

  it('never gives a secret’s value, in whole or in part, and shows the plain ones as they are', () => {
    env.HULY_URL = 'https://huly.example.com'
    env.HULY_PASSWORD = 'hunter2-very-secret'
    env.TALLY_LLM_KEY = 'llm-key-value'
    writeFileSync(settingsFile, JSON.stringify({ env: { HULY_PASSWORD: 'hunter2-very-secret' } }))
    const view = open().view()
    const text = JSON.stringify(view)
    for (const value of ['hunter2', 'very-secret', 'llm-key']) expect(text).not.toContain(value)
    const row = (name: string) => view.variables.find((each) => each.name === name)!
    expect(row('HULY_URL')).toMatchObject({ set: true, value: 'https://huly.example.com' })
    expect(row('HULY_PASSWORD')).toMatchObject({ set: true, value: null, sessions: 'same' })
    expect(row('TALLY_LLM_KEY')).toMatchObject({ set: true, value: null, sessions: null })
    expect(row('EVEN_KEEL_TOKEN')).toMatchObject({ set: false, value: null })
  })

  it('tells when the sessions’ settings hold another value or none', () => {
    env.HULY_PASSWORD = 'new'
    writeFileSync(settingsFile, JSON.stringify({ env: { HULY_PASSWORD: 'old' } }))
    expect(open().view().variables.find((each) => each.name === 'HULY_PASSWORD')?.sessions).toBe('other')
    writeFileSync(settingsFile, '{}')
    expect(open().view().variables.find((each) => each.name === 'HULY_PASSWORD')?.sessions).toBe('none')
  })

  it('writes a tracker key into one line of .env and into the sessions’ settings, and applies it', () => {
    writeFileSync(envFile, '# Huly\nHULY_URL=https://huly.example.com\nHULY_PASSWORD=old\n')
    writeFileSync(settingsFile, JSON.stringify({ model: 'opus', env: { HULY_PASSWORD: 'old' } }))
    open().set('HULY_PASSWORD', 'new')
    expect(readFileSync(envFile, 'utf8')).toBe('# Huly\nHULY_URL=https://huly.example.com\nHULY_PASSWORD=new\n')
    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toEqual({ model: 'opus', env: { HULY_PASSWORD: 'new' } })
    expect(applied).toBe(1)
  })

  it('writes a key of the service\'s own only into .env', () => {
    writeFileSync(settingsFile, '{}')
    open().set('TALLY_LLM_KEY', 'abc')
    expect(readFileSync(envFile, 'utf8')).toBe('TALLY_LLM_KEY=abc\n')
    expect(readFileSync(settingsFile, 'utf8')).toBe('{}')
  })

  it('refuses an empty value, an unknown variable and one the process got from outside .env', () => {
    const secrets = open(['HULY_URL'])
    expect(() => secrets.set('HULY_PASSWORD', '')).toThrow()
    expect(() => secrets.set('PATH', 'x')).toThrow()
    expect(() => secrets.set('HULY_URL', 'https://other.example.com')).toThrow()
    expect(applied).toBe(0)
  })

  it('writes several variables of .env at once and applies them once', () => {
    writeFileSync(envFile, 'TALLY_DB_HOST=old.example.com\n')
    open().setAll({ TALLY_DB_HOST: 'db.example.com', TALLY_DB_NAME: 'tally', TALLY_READER_PASSWORD: 'secret' })
    expect(readFileSync(envFile, 'utf8')).toBe('TALLY_DB_HOST=db.example.com\nTALLY_DB_NAME=tally\nTALLY_READER_PASSWORD=secret\n')
    expect(applied).toBe(1)
  })

  it('writes none of them when one is refused', () => {
    expect(() => open(['TALLY_DB_NAME']).setAll({ TALLY_DB_HOST: 'db.example.com', TALLY_DB_NAME: 'tally' })).toThrow()
    expect(() => open().setAll({ TALLY_DB_HOST: 'db.example.com', HULY_URL: 'https://huly.example.com' })).toThrow()
    expect(applied).toBe(0)
  })

  it('removes the variable from both places and tells the sessions’ daemon to restart', () => {
    writeFileSync(envFile, 'HULY_PASSWORD=old\nZ=1\n')
    writeFileSync(settingsFile, JSON.stringify({ env: { HULY_PASSWORD: 'old', OTHER: '1' } }))
    open().remove('HULY_PASSWORD')
    expect(readFileSync(envFile, 'utf8')).toBe('Z=1\n')
    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toEqual({ env: { OTHER: '1' } })
    expect(expired).toBe(1)
  })

  it('takes a page token only in its shape, and keeps it while the service listens beyond loopback', () => {
    const secrets = open()
    expect(() => secrets.set('EVEN_KEEL_TOKEN', 'short')).toThrow()
    secrets.set('EVEN_KEEL_TOKEN', 'abcdefghijklmnop0123')
    host = '0.0.0.0'
    expect(() => secrets.remove('EVEN_KEEL_TOKEN')).toThrow()
    expect(readFileSync(envFile, 'utf8')).toBe('EVEN_KEEL_TOKEN=abcdefghijklmnop0123\n')
    expect(secrets.view().variables.find((each) => each.name === 'EVEN_KEEL_TOKEN')?.required).toBe(true)
  })
})
