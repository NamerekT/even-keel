import { describe, expect, it } from 'vitest'
import { partsOf } from './body-size.js'

describe('partsOf', () => {
  it('goes down the largest part of a snapshot, naming how many parts each level has', () => {
    const tasks = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`ABC-${index}`, { feed: 'x'.repeat(4096 * (index + 1)) }]))
    const text = partsOf({ connection: 'c', lastCommand: 3, snapshot: { facts: { tasks, sessions: {} }, records: [] } })
    expect(text).toMatch(/^body \(3 parts\): snapshot \d+ KB, connection 1 KB, lastCommand 1 KB; snapshot \(2 parts\): facts \d+ KB, records 1 KB; /)
    expect(text).toContain('snapshot.facts (2 parts): tasks')
    expect(text).toContain('snapshot.facts.tasks (8 parts): ABC-7 33 KB, ABC-6 29 KB, ABC-5 25 KB, ABC-4 21 KB, ABC-3 17 KB, …')
  })

  it('names the events of a post by type', () => {
    const events = [
      { seq: 1, type: 'handoff', at: 0, payload: 'x'.repeat(5000) },
      { seq: 2, type: 'transcript', at: 0 },
      { seq: 3, type: 'handoff', at: 0, payload: 'x'.repeat(5000) },
    ]
    expect(partsOf({ connection: 'c', events })).toMatch(/; events \(2 parts\): handoff ×2 10 KB, transcript ×1 1 KB; /)
  })

  it('goes on into the largest event of the largest type, down to the sections of its facts and their keys', () => {
    const set = Object.fromEntries(Array.from({ length: 3 }, (_, index) => [`session-${index}`, { feed: 'x'.repeat(8192 * (index + 1)) }]))
    const facts = (seq: number, sessions: object) => ({ seq, type: 'facts', at: 0, payload: { boot: 'b', rev: seq, patch: { sessions, tasks: { set: { 'ABC-1': {} } } } } })
    const text = partsOf({ connection: 'c', events: [facts(1, { set: {} }), facts(2, { set, gone: ['session-9'] })] })
    expect(text).toContain('events (1 parts): facts ×2 ')
    expect(text).toContain('; facts (4 parts): payload ')
    expect(text).toContain('; facts.payload (3 parts): patch ')
    expect(text).toContain('; facts.payload.patch (2 parts): sessions ')
    expect(text).toContain('; facts.payload.patch.sessions (2 parts): set ')
    expect(text).toMatch(/; facts\.payload\.patch\.sessions\.set \(3 parts\): session-2 25 KB, session-1 17 KB, session-0 9 KB; .*session-2 \(1 parts\): feed 25 KB$/)
  })

  it('says nothing of a body without parts', () => {
    expect(partsOf('text')).toBe('')
  })
})
