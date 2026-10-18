import { describe, expect, it } from 'vitest'
import { diffSection } from './diff.js'

describe('diffSection', () => {
  it('keeps equal lines and marks the added and the removed ones', () => {
    expect(diffSection('## [Unreleased]\n\n- Old.', '## [Unreleased]\n\n- New entry here.\n- Another.')).toEqual([
      { kind: 'same', pieces: [{ kind: 'same', text: '## [Unreleased]' }] },
      { kind: 'same', pieces: [{ kind: 'same', text: '' }] },
      { kind: 'removed', pieces: [{ kind: 'removed', text: '- Old.' }] },
      { kind: 'added', pieces: [{ kind: 'added', text: '- New entry here.' }] },
      { kind: 'added', pieces: [{ kind: 'added', text: '- Another.' }] },
    ])
  })

  it('shows a line with a few words changed as one line with the words marked', () => {
    expect(diffSection('- The chain runs one session at a time.', '- The chain runs two sessions at a time.')).toEqual([
      {
        kind: 'changed',
        pieces: [
          { kind: 'same', text: '- The chain runs ' },
          { kind: 'removed', text: 'one session' },
          { kind: 'added', text: 'two sessions' },
          { kind: 'same', text: ' at a time.' },
        ],
      },
    ])
  })

  it('gives every line unmarked when there is nothing to compare with', () => {
    expect(diffSection(null, 'a\nb').map((line) => line.kind)).toEqual(['same', 'same'])
  })
})
