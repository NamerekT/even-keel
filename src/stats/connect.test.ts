import { describe, expect, it } from 'vitest'
import { noticeOf } from '../notice/notice.js'
import { checkServer, serverValues } from './connect.js'

const draft = { host: ' db.example.com ', port: '', name: ' tally ', readerPassword: 'read', writerPassword: 'write' }

describe('serverValues', () => {
  it('gives the .env lines of the draft, the port 5432 when blank', () => {
    expect(serverValues(draft, {})).toEqual({
      TALLY_DB_HOST: 'db.example.com',
      TALLY_DB_PORT: '5432',
      TALLY_DB_NAME: 'tally',
      TALLY_READER_PASSWORD: 'read',
      TALLY_WRITER_PASSWORD: 'write',
    })
  })

  it('keeps the passwords .env has when the draft leaves them blank', () => {
    const env = { TALLY_READER_PASSWORD: 'old-read', TALLY_WRITER_PASSWORD: 'old-write' }
    expect(serverValues({ ...draft, readerPassword: '', writerPassword: '' }, env)).toMatchObject({ TALLY_READER_PASSWORD: 'old-read', TALLY_WRITER_PASSWORD: 'old-write' })
  })

  it('takes everything from .env without a draft: turning it on again', () => {
    const env = { TALLY_DB_HOST: 'db.example.com', TALLY_DB_PORT: '6543', TALLY_DB_NAME: 'tally', TALLY_READER_PASSWORD: 'r', TALLY_WRITER_PASSWORD: 'w' }
    expect(serverValues(null, env)).toEqual(env)
  })

  it('names what is missing', () => {
    expect(() => serverValues({ ...draft, host: ' ', readerPassword: '' }, {})).toThrow(/TALLY_DB_HOST, TALLY_READER_PASSWORD/)
  })

  it('refuses a port that is not one', () => {
    for (const port of ['abc', '0', '70000', '54.3']) expect(noticeOf(catchOf(() => serverValues({ ...draft, port }, {})))?.code).toBe('tally.port')
  })
})

describe('checkServer', () => {
  const values = serverValues(draft, {})

  it('signs in as the reader and the writer', async () => {
    const seen: string[] = []
    await checkServer(values, {}, async (settings) => void seen.push(`${settings.user}:${settings.password}@${settings.host}:${settings.port}/${settings.database}`))
    expect(seen).toEqual(['tally_reader:read@db.example.com:5432/tally', 'tally_writer:write@db.example.com:5432/tally'])
  })

  it('takes the role names .env sets', async () => {
    const seen: string[] = []
    await checkServer(values, { TALLY_READER_USER: 'viewer', TALLY_WRITER_USER: 'loader' }, async (settings) => void seen.push(settings.user))
    expect(seen).toEqual(['viewer', 'loader'])
  })

  it('says which role was refused and why', async () => {
    const refused = await checkServer(values, {}, async (settings) => {
      if (settings.user === 'tally_writer') throw new Error('password authentication failed')
    }).catch((error: unknown) => noticeOf(error))
    expect(refused).toMatchObject({ code: 'tally.unreachable', params: { role: 'tally_writer', address: 'db.example.com:5432' }, detail: 'password authentication failed' })
  })
})

function catchOf(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}
