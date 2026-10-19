import { describe, expect, it } from 'vitest'
import { inferredTallyMode, tallyKey } from './mode.js'

describe('inferredTallyMode', () => {
  it('keeps an installation on the Postgres its .env names', () => {
    expect(inferredTallyMode({ TALLY_DB_HOST: 'db.example.com' }, true)).toBe('server')
  })

  it('keeps one whose embedded database exists on it', () => {
    expect(inferredTallyMode({}, true)).toBe('local')
    expect(inferredTallyMode({ TALLY_DB_HOST: '' }, true)).toBe('local')
  })

  it('leaves a fresh one unchosen', () => {
    expect(inferredTallyMode({}, false)).toBeNull()
  })
})

describe('tallyKey', () => {
  it('changes with the mode and the database variables', () => {
    const env = { TALLY_DB_HOST: 'db.example.com', TALLY_READER_PASSWORD: 'secret' }
    expect(tallyKey('server', env)).not.toBe(tallyKey('local', env))
    expect(tallyKey('server', env)).not.toBe(tallyKey('server', { ...env, TALLY_DB_PORT: '5433' }))
  })

  it('ignores the variables the collector reads at each pass, the order and blank values', () => {
    const env = { TALLY_READER_PASSWORD: 'secret', TALLY_DB_HOST: 'db.example.com' }
    expect(tallyKey('server', { ...env, TALLY_LLM_KEY: 'key', HULY_URL: 'https://huly.example.com' })).toBe(tallyKey('server', env))
    expect(tallyKey('server', { TALLY_DB_HOST: 'db.example.com', TALLY_READER_PASSWORD: 'secret', TALLY_DB_NAME: '' })).toBe(tallyKey('server', env))
  })
})
