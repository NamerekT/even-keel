import { describe, expect, it } from 'vitest'
import { isTaskId, parsePeriodQuery, parseStatsFilter, readerSettings, repoTail } from './model.js'

describe('parseStatsFilter', () => {
  it('defaults to every session of every account in UTC', () => {
    expect(parseStatsFilter(new URLSearchParams())).toEqual({ scope: 'all', account: null, tz: 'UTC' })
  })

  it('takes the chain scope, an account and a time zone', () => {
    expect(parseStatsFilter(new URLSearchParams('scope=chain&account=work&tz=America/Argentina/Buenos_Aires'))).toEqual({
      scope: 'chain',
      account: 'work',
      tz: 'America/Argentina/Buenos_Aires',
    })
  })

  it('rejects an unknown scope and a zone that is not a name', () => {
    expect(() => parseStatsFilter(new URLSearchParams('scope=mine'))).toThrow(/scope/)
    expect(() => parseStatsFilter(new URLSearchParams("tz=UTC';"))).toThrow(/tz/)
  })
})

describe('parsePeriodQuery', () => {
  it('reads both days and the projects', () => {
    expect(parsePeriodQuery(new URLSearchParams('from=2026-09-04&to=2026-10-03&projects=ABC,Example'))).toMatchObject({
      from: '2026-09-04',
      to: '2026-10-03',
      projects: ['ABC', 'Example'],
    })
  })

  it('treats missing projects as all and an empty list as none', () => {
    expect(parsePeriodQuery(new URLSearchParams('from=2026-10-03&to=2026-10-03')).projects).toBeNull()
    expect(parsePeriodQuery(new URLSearchParams('from=2026-10-03&to=2026-10-03&projects=')).projects).toEqual([])
  })

  it('rejects missing, impossible and reversed days', () => {
    expect(() => parsePeriodQuery(new URLSearchParams('from=2026-10-03'))).toThrow(/from and to/)
    expect(() => parsePeriodQuery(new URLSearchParams('from=2026-02-30&to=2026-03-01'))).toThrow(/from and to/)
    expect(() => parsePeriodQuery(new URLSearchParams('from=2026-10-03&to=2026-10-01'))).toThrow(/after/)
  })
})

describe('isTaskId', () => {
  it('accepts a tracker key and rejects anything else', () => {
    expect(isTaskId('ABC-12')).toBe(true)
    expect(isTaskId('abc-12')).toBe(false)
    expect(isTaskId("ABC-1'")).toBe(false)
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
