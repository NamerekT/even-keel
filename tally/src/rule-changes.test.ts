import { describe, expect, it } from 'vitest'
import { changesOf, firstSnapshotAt, pickPath } from './rule-changes.js'

describe('firstSnapshotAt', () => {
  const now = '2026-10-03T21:00:00.000Z'
  const previous = '2026-10-03T20:55:00.000Z'
  it('dates a newly scanned file older than the previous scan to the bootstrap', () => {
    expect(firstSnapshotAt('2026-09-09T10:00:00.000Z', previous, '2026-10-03T12:00:00.000Z', now)).toBe('2026-10-03T12:00:00.000Z')
  })

  it('keeps the scan time for a file made since the previous scan or on the first run', () => {
    expect(firstSnapshotAt('2026-10-03T20:58:00.000Z', previous, '2026-10-03T12:00:00.000Z', now)).toBe(now)
    expect(firstSnapshotAt('2026-09-09T10:00:00.000Z', null, null, now)).toBe(now)
  })
})

const boot = '2026-10-03T12:00:00.000Z'

describe('changesOf', () => {
  it('turns transcript versions into changes, the first one being the initial state', () => {
    const changes = changesOf(
      'k',
      [
        { at: '2026-09-05T10:00:00.000Z', hash: 'b' },
        { at: '2026-09-04T10:00:00.000Z', hash: 'a' },
        { at: '2026-09-07T10:00:00.000Z', hash: 'c' },
      ],
      [],
      null,
    )
    expect(changes).toEqual([
      { key: 'k', at: '2026-09-05T10:00:00.000Z', oldHash: 'a', newHash: 'b', source: 'transcript' },
      { key: 'k', at: '2026-09-07T10:00:00.000Z', oldHash: 'b', newHash: 'c', source: 'transcript' },
    ])
  })

  it('keeps the source of a version found outside transcripts', () => {
    const changes = changesOf(
      'k',
      [
        { at: '2026-09-04T10:00:00.000Z', hash: 'a' },
        { at: '2026-09-05T10:00:00.000Z', hash: 'b', source: 'file-history' },
        { at: '2026-09-06T10:00:00.000Z', hash: 'c', source: 'git' },
      ],
      [],
      null,
    )
    expect(changes.map((change) => change.source)).toEqual(['file-history', 'git'])
  })

  it('ignores transcript versions from the first snapshot on and treats the bootstrap as no change', () => {
    const changes = changesOf(
      'k',
      [
        { at: '2026-09-04T10:00:00.000Z', hash: 'a' },
        { at: '2026-10-03T13:00:00.000Z', hash: 'worktree' },
      ],
      [
        { at: boot, hash: 'body' },
        { at: '2026-10-03T14:00:00.000Z', hash: 'body2' },
        { at: '2026-10-03T15:00:00.000Z', hash: null },
      ],
      boot,
    )
    expect(changes).toEqual([
      { key: 'k', at: '2026-10-03T14:00:00.000Z', oldHash: 'body', newHash: 'body2', source: 'snapshot' },
      { key: 'k', at: '2026-10-03T15:00:00.000Z', oldHash: 'body2', newHash: null, source: 'snapshot' },
    ])
  })

  it('reports a file that appears after the bootstrap as created', () => {
    expect(changesOf('k', [], [{ at: '2026-10-04T10:00:00.000Z', hash: 'x' }], boot)).toEqual([
      { key: 'k', at: '2026-10-04T10:00:00.000Z', oldHash: null, newHash: 'x', source: 'snapshot' },
    ])
  })

  it('compares a later first snapshot with the last transcript version', () => {
    const seen = [{ at: '2026-09-04T10:00:00.000Z', hash: 'a' }]
    expect(changesOf('k', seen, [{ at: '2026-10-04T10:00:00.000Z', hash: 'a' }], boot)).toEqual([])
    expect(changesOf('k', seen, [{ at: '2026-10-04T10:00:00.000Z', hash: 'b' }], boot)).toEqual([
      { key: 'k', at: '2026-10-04T10:00:00.000Z', oldHash: 'a', newHash: 'b', source: 'snapshot' },
    ])
  })
})

describe('pickPath', () => {
  it('prefers the global config folder over account copies', () => {
    expect(pickPath(['C:/Users/Jane/.claude-accounts/a/CLAUDE.md', 'C:/Users/Jane/.claude/CLAUDE.md'])).toBe('C:/Users/Jane/.claude/CLAUDE.md')
    expect(pickPath(['C:/Users/Jane/.claude-accounts/b/x.md', 'C:/Users/Jane/.claude-accounts/a/x.md'])).toBe('C:/Users/Jane/.claude-accounts/a/x.md')
  })
})
