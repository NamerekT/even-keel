import { describe, expect, it } from 'vitest'
import { noteAtEnd } from './note.js'
import type { FeedLine } from './transcript.js'

const at = '2026-10-18T10:00:00.000Z'
const prompt = (text: string): FeedLine => ({ at, kind: 'prompt', text })
const tool = (name: string, subject?: string): FeedLine => ({ at, kind: 'tool', text: name, name, ...(subject === undefined ? {} : { subject }) })
const text = (value: string): FeedLine => ({ at, kind: 'text', text: value })
const note = (path = '.temp/handoff.md') => tool('Write', path)

describe('noteAtEnd', () => {
  it('catches a note written among the last calls of the turn', () => {
    expect(noteAtEnd([prompt('ABC-1'), tool('Bash', 'commit'), note(), text('The checkpoint is ready.')])).toBe(true)
  })

  it('matches a Claude Code Write or Edit and a Codex file change, by any absolute path', () => {
    expect(noteAtEnd([prompt('x'), note('D:\\work\\tree\\.temp\\handoff.md')])).toBe(true)
    expect(noteAtEnd([prompt('x'), tool('MultiEdit', '/w/.temp/handoff.md')])).toBe(true)
    expect(noteAtEnd([prompt('x'), tool('Edit', 'D:\\Projects\\repo\\.claude\\worktrees\\abc-1\\.temp\\handoff.md'), { at, kind: 'failed', text: 'x' }])).toBe(true)
  })

  it('leaves a turn alone that carried on well after the note', () => {
    expect(noteAtEnd([prompt('x'), note(), tool('Bash', 'test'), tool('Bash', 'merge'), tool('Bash', 'log')])).toBe(false)
  })

  it('leaves a turn alone that wrote no note, or a note before the last prompt or answer', () => {
    expect(noteAtEnd([prompt('x'), tool('Bash', 'test')])).toBe(false)
    expect(noteAtEnd([prompt('x'), note(), prompt('go on')])).toBe(false)
    expect(noteAtEnd([prompt('x'), note(), { at, kind: 'answer', text: 'yes' }])).toBe(false)
    expect(noteAtEnd([])).toBe(false)
  })

  it('ignores other files named handoff and reads of the note', () => {
    expect(noteAtEnd([prompt('x'), note('docs/handoff.md')])).toBe(false)
    expect(noteAtEnd([prompt('x'), tool('Read', '.temp/handoff.md')])).toBe(false)
  })
})
