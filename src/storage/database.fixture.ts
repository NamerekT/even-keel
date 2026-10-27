import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { expect } from 'vitest'
import { fixEpisodes, isLaunch } from '../chain/launches.js'
import { readSnapshots } from '../chain/snapshots.js'
import { closedTasks, loadChainState, loadQuestions, readLaunches } from '../chain/store.js'
import { root } from '../locations.js'
import { Mailbox } from '../sessions/mailbox.js'
import { DATABASE_VERSION, databaseVersion, Writes, type Queryable } from './database.js'

// Frozen samples of the database. Versions 1 and 2 were `node:sqlite` files: they are imported at the first start.
// Version 3 is the first PGlite one, version 4 adds the settings, version 5 the tracker profiles, version 6 the
// changelog drafts, version 7 their turns' spend, version 8 the pull requests, version 9 the colors, version 10 the
// shelved tasks, version 11 the keys shared by projects, version 12 the profiles' rules and the extra task feeds, version
// 13 the tracker of every project its own, version 14 the organizations of the API keys, version 15 the MCP OAuth grants:
// a later step must migrate each, and each step itself must still make exactly the tables of its sample.
// A schema change is a new step and a new sample next to these, never an edit of either.
export const fixture = (version: number) => readFileSync(join(root, 'test', 'fixtures', `database-v${version}`, 'even-keel.sql'), 'utf8')

export const ABC = '11111111-1111-4111-8111-111111111111'
export const XYZ = '22222222-2222-4222-8222-222222222222'
/** A second project of the key `ABC` (BTN-271). */
export const SECOND_ABC = '66666666-6666-4666-8666-666666666666'
/** The extra task feed of `ABC` (BTN-66). */
export const FEED = '77777777-7777-4777-8777-777777777777'

export async function readsWhole(db: Queryable, version = 3) {
  expect(await databaseVersion(db)).toBe(DATABASE_VERSION)
  const state = await loadChainState(db)
  expect(state.active.map((chain) => [chain.project, chain.current?.task])).toEqual([[ABC, 'ABC-2']])
  expect(state.queue).toEqual([XYZ])
  expect(state.orders).toEqual({ [ABC]: ['ABC-1', 'ABC-2', 'ABC-3'], [XYZ]: ['XYZ-7'] })
  expect(state.skipped).toEqual({ [ABC]: ['ABC-9'] })
  expect(state.leftovers[XYZ]?.[0]?.task).toBe('XYZ-1')
  expect(state.released).toEqual({ [ABC]: ['ABC-1'] })
  expect(state.ci[ABC]?.afterGreen).toBe(state.ci[ABC]?.green)
  expect((await loadQuestions(db)).map((question) => [question.task, question.done === true])).toEqual([['ABC-2', false]])
  const launches = await readLaunches(db)
  expect(launches.filter(isLaunch).map((entry) => entry.task)).toEqual(['ABC-1', 'ABC-2', 'ABC-FIX', 'ABC-FIX'])
  expect(launches[0]?.fallback).toBe('codex')
  expect(fixEpisodes(launches).episodes[ABC]?.map((episode) => [episode.id, episode.end?.how])).toEqual([
    ['ABC-FIX.1', 'landed'],
    ['ABC-FIX.2', 'dropped'],
  ])
  const [snapshot] = await readSnapshots(db)
  expect(snapshot).toMatchObject({ task: 'ABC-2', reason: 'relay', notePath: 'C:\\repos\\example-project\\.temp\\handoff.md' })
  expect(snapshot?.note).toContain('Done: the parser.')
  expect(await closedTasks(db)).toEqual([
    expect.objectContaining({
      project: ABC,
      task: 'ABC-1',
      tracker: 'huly',
      title: 'Parse the example input',
      url: 'https://huly.example.com/workbench/example/browse/ABC-1',
      closedAt: '2026-10-04T12:00:00.000Z',
    }),
    ...(version >= 12 ? [{
      project: ABC,
      task: 'ABCGH-4',
      tracker: 'github',
      title: 'Accept the second input format',
      url: 'https://github.com/octo-org/ideas/issues/4',
      closedAt: '2026-10-22T08:00:00.000Z',
      profile: '55555555-5555-4555-8555-555555555555',
      status: 'closed',
    }] : []),
  ])
}

export async function mailboxOf(db: PGlite) {
  const mailbox = await Mailbox.open(db, new Writes(() => {}), () => new Date('2026-10-18T10:10:00.000Z'))
  return {
    waiting: mailbox.waiting().map((mail) => mail.text),
    session: mailbox.of('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee').map((mail) => [mail.fate, mail.event, mail.files]),
  }
}

export async function schemaOf(db: Queryable) {
  const columns = await db.query(
    `select table_name, column_name, data_type, is_nullable, column_default, is_identity
       from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`,
  )
  const indexes = await db.query("select indexname, indexdef from pg_indexes where schemaname = 'public' order by indexname")
  const constraints = await db.query(
    `select conrelid::regclass::text as on_table, conname, pg_get_constraintdef(oid) as def
       from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`,
  )
  return { columns: columns.rows, indexes: indexes.rows, constraints: constraints.rows }
}
