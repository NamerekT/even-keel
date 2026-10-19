import pg from 'pg'
import { fail } from '../notice/notice.js'
import type { ReaderSettings } from './model.js'

/** The fields of the user's own Postgres on the page; a blank password keeps the one `.env` has. */
export interface TallyServerDraft {
  host: string
  port: string
  name: string
  readerPassword: string
  writerPassword: string
}

export type TallyServerValues = Record<'TALLY_DB_HOST' | 'TALLY_DB_PORT' | 'TALLY_DB_NAME' | 'TALLY_READER_PASSWORD' | 'TALLY_WRITER_PASSWORD', string>

type Env = Record<string, string | undefined>
export type Connect = (settings: ReaderSettings) => Promise<void>

const DEFAULT_PORT = '5432'
const CONNECT_TIMEOUT_MS = 5_000

/** The `.env` lines the draft makes; without a draft — the ones `.env` has, to turn the stats on again. Throws a `tally.*` notice. */
export function serverValues(draft: TallyServerDraft | null, env: Env): TallyServerValues {
  const port = (draft === null ? env.TALLY_DB_PORT : draft.port)?.trim() || DEFAULT_PORT
  const values: TallyServerValues = {
    TALLY_DB_HOST: (draft === null ? env.TALLY_DB_HOST : draft.host)?.trim() ?? '',
    TALLY_DB_PORT: port,
    TALLY_DB_NAME: (draft === null ? env.TALLY_DB_NAME : draft.name)?.trim() ?? '',
    TALLY_READER_PASSWORD: draft?.readerPassword || env.TALLY_READER_PASSWORD || '',
    TALLY_WRITER_PASSWORD: draft?.writerPassword || env.TALLY_WRITER_PASSWORD || '',
  }
  const missing = Object.entries(values).flatMap(([name, value]) => (value === '' ? [name] : []))
  if (missing.length > 0) throw fail('tally.incomplete', { names: missing.join(', ') })
  const number = Number(port)
  if (!/^\d+$/.test(port) || number < 1 || number > 65_535) throw fail('tally.port', { value: port })
  return values
}

/** Signs in as the reader the page reads with and the writer the collector writes with; throws `tally.unreachable`. */
export async function checkServer(values: TallyServerValues, env: Env, connect: Connect = signIn): Promise<void> {
  const base = { host: values.TALLY_DB_HOST, port: Number(values.TALLY_DB_PORT), database: values.TALLY_DB_NAME }
  const roles = [
    { user: env.TALLY_READER_USER || 'tally_reader', password: values.TALLY_READER_PASSWORD },
    { user: env.TALLY_WRITER_USER || 'tally_writer', password: values.TALLY_WRITER_PASSWORD },
  ]
  for (const role of roles) {
    try {
      await connect({ ...base, ...role })
    } catch (error) {
      throw fail('tally.unreachable', { role: role.user, address: `${base.host}:${base.port}` }, { detail: (error as Error).message })
    }
  }
}

async function signIn(settings: ReaderSettings): Promise<void> {
  const client = new pg.Client({ ...settings, connectionTimeoutMillis: CONNECT_TIMEOUT_MS })
  client.on('error', () => {})
  try {
    await client.connect()
    await client.query('select 1')
  } finally {
    await client.end().catch(() => {})
  }
}
