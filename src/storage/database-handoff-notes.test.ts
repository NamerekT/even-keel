import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { keepHandoffNote, lastHandoffNote, noteFrom, writeHandoffNote, type HandoffNote } from '../chain/handoff-notes.js'
import { forgetProjectRows } from '../chain/store.js'
import { insertRows, rowsOf } from './copy.js'
import { ABC, fixture, readsWhole, schemaOf } from './database.fixture.js'
import { openDatabase, STEPS } from './database.js'

const CURRENT = '00000000-0000-4000-8000-0000000000a1'
const OLDER = '00000000-0000-4000-8000-0000000000a0'
const MACHINE = '88888888-8888-4888-8888-888888888888'

const note = (sessionId: string, text: string, task = 'ABC-2'): HandoffNote => ({
  project: ABC,
  task,
  sessionId,
  branch: 'abc-2/parser',
  machine: MACHINE,
  at: '2026-10-01T11:00:00.000Z',
  note: text,
})

describe('step 53: the handoff notes (BTN-1046)', { timeout: 120_000 }, () => {
  it('makes the table of the frozen sample and reads its rows', async () => {
    const frozen = await PGlite.create()
    const made = await openDatabase(undefined, STEPS.slice(0, 51))
    try {
      await frozen.exec(fixture(53))
      expect(await schemaOf(made)).toEqual(await schemaOf(frozen))
      await readsWhole(frozen, 53, 53)
      expect(await lastHandoffNote(frozen, ABC, 'ABC-2')).toMatchObject({ sessionId: CURRENT, branch: 'abc-2/parser', machine: MACHINE, note: expect.stringContaining('Done: the parser.') })
      await insertRows(made, await rowsOf(frozen))
      expect(await rowsOf(made)).toEqual(await rowsOf(frozen))
    } finally {
      await Promise.all([frozen.close(), made.close()])
    }
  })

  it('takes the sample of the step before', async () => {
    const db = await PGlite.create()
    try {
      await db.exec(fixture(52))
      await db.exec(STEPS[50]!)
      expect(await lastHandoffNote(db, ABC, 'ABC-2')).toBeUndefined()
    } finally {
      await db.close()
    }
  })
})

describe('handoff notes', { timeout: 120_000 }, () => {
  it("keeps a note only from the session the launch journal names last for the task", async () => {
    const frozen = await PGlite.create()
    const db = await openDatabase(undefined)
    try {
      await frozen.exec(fixture(53))
      await insertRows(db, await rowsOf(frozen))
      expect(await writeHandoffNote(db, note(OLDER, 'late note of the session before'))).toBe('stale')
      expect(await writeHandoffNote(db, note(CURRENT, 'ABC-3 is the next step', 'ABC-3'))).toBe('notLaunched')
      expect(await writeHandoffNote(db, note(CURRENT, 'Done: the lexer. Next: the parser.'))).toBeNull()
      expect((await lastHandoffNote(db, ABC, 'ABC-2'))?.note).toBe('Done: the lexer. Next: the parser.')
      await keepHandoffNote(db, note(OLDER, 'read from the file of the session handed over'))
      expect((await lastHandoffNote(db, ABC, 'ABC-2'))?.sessionId).toBe(OLDER)
      await forgetProjectRows(db, ABC)
      expect(await lastHandoffNote(db, ABC, 'ABC-2')).toBeUndefined()
    } finally {
      await Promise.all([frozen.close(), db.close()])
    }
  })

  it("gives a handoff the note only when the session handed over wrote it", () => {
    const kept = { sessionId: CURRENT, at: '2026-10-01T11:00:00.000Z', note: 'Next: npm test' }
    expect(noteFrom(kept, CURRENT)).toBe('Next: npm test')
    expect(noteFrom(kept, OLDER)).toBeNull()
    expect(noteFrom({ ...kept, note: '  ' }, CURRENT)).toBeNull()
    expect(noteFrom(undefined, CURRENT)).toBeNull()
  })
})
