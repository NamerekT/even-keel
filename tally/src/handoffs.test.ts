import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { LaunchEntry } from '../../src/chain/dispatcher.js'
import type { Entry } from '../../src/sessions/entry.js'
import { noteFromWrites, notePathOf, rowOfSnapshot, rowOfTranscripts } from './handoffs.js'

const NOTE = 'D:/work/abc/.claude/worktrees/abc-1/.temp/handoff.md'
const NOTE_WIN = 'D:\\work\\abc\\.claude\\worktrees\\abc-1\\.temp\\handoff.md'

const call = (name: string, input: Record<string, unknown>): Entry =>
  ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: `t-${Math.random()}`, name, input }] } }) as Entry
const user = (content: string): Entry => ({ type: 'user', message: { role: 'user', content } }) as Entry

describe('notePathOf', () => {
  it('finds the note line of a handoff prompt in either language', () => {
    expect(notePathOf(`ABC-1\n\n- Handoff note: ${NOTE} — read it first: what is done.`)).toBe(NOTE)
    expect(notePathOf(`ABC-1\n\n- Записка о передаче: ${NOTE} — прочитай её первой.`)).toBe(NOTE)
  })

  it('returns null for a prompt without a note', () => {
    expect(notePathOf('ABC-1\n\nRecent steps:\n- Read x')).toBeNull()
  })
})

describe('noteFromWrites', () => {
  it('takes the last write of the note and applies the edits after it', () => {
    const entries = [
      call('Write', { file_path: NOTE_WIN, content: 'old note' }),
      call('Write', { file_path: NOTE_WIN, content: '# Note\nstep 1\nstep 1\n' }),
      call('Write', { file_path: 'D:\\work\\abc\\other.md', content: 'other' }),
      call('Edit', { file_path: NOTE_WIN, old_string: 'step 1', new_string: 'step $1' }),
      call('Edit', { file_path: NOTE_WIN, old_string: 'missing', new_string: 'x' }),
      call('Edit', { file_path: NOTE_WIN, old_string: '\n', new_string: '\r\n', replace_all: true }),
    ]
    expect(noteFromWrites(entries, NOTE)).toBe('# Note\r\nstep $1\r\nstep 1\r\n')
  })

  it('returns null when the note was only edited, its start being unknown', () => {
    expect(noteFromWrites([call('Edit', { file_path: NOTE, old_string: 'a', new_string: 'b' })], NOTE)).toBeNull()
  })
})

describe('rowOfSnapshot', () => {
  it('reads a snapshot Even Keel saved', () => {
    const raw = {
      at: '2026-10-10T18:12:05.306Z', task: 'ABC-1', sessionId: 'new', previous: 'old', reason: 'checkpoint',
      prompt: 'ABC-1 …', notePath: NOTE, note: '# Note',
    }
    expect(rowOfSnapshot(raw)).toEqual({ ...raw, source: 'even-keel' })
  })

  it('refuses anything without a session, a previous session or a prompt', () => {
    expect(rowOfSnapshot({ task: 'ABC-1', previous: 'old', prompt: 'x' })).toBeNull()
    expect(rowOfSnapshot(null)).toBeNull()
  })
})

describe('handoff_notes', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await PGlite.create()
    await db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
  }, 30_000)

  afterAll(async () => {
    await db?.close()
  })

  it('lists the headings of a note, CRLF or not, and the sizes', async () => {
    await db.query(
      `insert into handoffs (session_id, previous, task, reason, source, prompt, note) values
       ('a', 'p', 'ABC-1', 'checkpoint', 'even-keel', 'ABC-1', $1), ('b', 'a', 'ABC-1', 'relay', 'transcript', 'ABC-1 steps', null)`,
      ['# ABC-1 — note 1\r\nsome text\r\n## Done \r\n- x\n#not a heading\n### Next command\n'],
    )
    const { rows } = await db.query('select session_id, headings, note_chars, prompt_chars from handoff_notes order by session_id')
    expect(rows).toEqual([
      { session_id: 'a', headings: ['ABC-1 — note 1', 'Done', 'Next command'], note_chars: 75, prompt_chars: 5 },
      { session_id: 'b', headings: [], note_chars: null, prompt_chars: 11 },
    ])
  })
})

describe('rowOfTranscripts', () => {
  const launch: LaunchEntry = { at: '2026-10-10T18:12:05.306Z', project: 'ABC', task: 'ABC-1', sessionId: 'new', reason: 'checkpoint', previous: 'old' }
  const prompt = `ABC-1\n\n- Handoff note: ${NOTE} — read it first.`

  it('puts together the prompt the new session got and the note the old one wrote', () => {
    const row = rowOfTranscripts(launch, [user(prompt), user('more')], () => [call('Write', { file_path: NOTE_WIN, content: '# Note' })])
    expect(row).toEqual({
      at: launch.at, task: 'ABC-1', sessionId: 'new', previous: 'old', reason: 'checkpoint',
      prompt, notePath: NOTE, note: '# Note', source: 'transcript',
    })
  })

  it('keeps the prompt when the old transcript is gone, and gives nothing before the new session has its prompt', () => {
    expect(rowOfTranscripts(launch, [user(prompt)], () => null)).toMatchObject({ prompt, notePath: NOTE, note: null })
    expect(rowOfTranscripts(launch, [], () => null)).toBeNull()
  })
})
