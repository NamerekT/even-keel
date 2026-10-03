import { describe, expect, it } from 'vitest'
import { parseStatsQuery, readerSettings, repoTail } from './model.js'

describe('parseStatsQuery', () => {
  it('defaults to a week of every session', () => {
    expect(parseStatsQuery(new URLSearchParams())).toEqual({ days: 7, scope: 'all' })
  })

  it('takes a known period and the chain scope', () => {
    expect(parseStatsQuery(new URLSearchParams('days=30&scope=chain'))).toEqual({ days: 30, scope: 'chain' })
  })

  it('rejects a period it does not offer', () => {
    expect(() => parseStatsQuery(new URLSearchParams('days=3'))).toThrow(/days/)
  })

  it('rejects an unknown scope', () => {
    expect(() => parseStatsQuery(new URLSearchParams('scope=mine'))).toThrow(/scope/)
  })
})

describe('repoTail', () => {
  it('drops the drive, lowercases and uses forward slashes', () => {
    expect(repoTail('C:\\Projects\\Example')).toBe('/projects/example')
    expect(repoTail('d:/Projects/Example/')).toBe('/projects/example')
  })

  it('keeps a path without a drive', () => {
    expect(repoTail('/home/john/example')).toBe('/home/john/example')
  })
})

describe('readerSettings', () => {
  const env = { TALLY_DB_HOST: 'db.example.com', TALLY_DB_NAME: 'tally', TALLY_READER_PASSWORD: 'secret' }

  it('reads the reader role from the environment', () => {
    expect(readerSettings(env)).toEqual({ host: 'db.example.com', port: 5432, database: 'tally', user: 'tally_reader', password: 'secret' })
  })

  it('takes a port and another user name', () => {
    expect(readerSettings({ ...env, TALLY_DB_PORT: '6543', TALLY_READER_USER: 'viewer' })).toMatchObject({ port: 6543, user: 'viewer' })
  })

  it('names what is missing', () => {
    expect(readerSettings({ TALLY_DB_HOST: 'db.example.com' })).toBe('TALLY_DB_NAME, TALLY_READER_PASSWORD')
  })
})
