import { describe, expect, it } from 'vitest'
import { noteAtEnd } from './note.js'
import type { FeedLine } from './transcript.js'
import { RolloutFold } from '../codex/rollout.js'

const at = '2026-10-18T10:00:00.000Z'
const prompt = (text: string): FeedLine => ({ at, kind: 'prompt', text })
const tool = (name: string, subject?: string): FeedLine => ({ at, kind: 'tool', text: name, name, ...(subject === undefined ? {} : { subject }) })
const text = (value: string): FeedLine => ({ at, kind: 'text', text: value })
const note = (path = '.temp/handoff.md') => tool('Write', path)

describe('noteAtEnd', () => {
  const shell = (command: string): FeedLine => ({ ...tool('Shell'), detail: command })

  it.each([
    `[System.IO.File]::WriteAllText('.temp/handoff.md', 'ready')`,
    `[IO.File]::WriteAllText('D:\\work tree\\.temp\\handoff.md', 'ready')`,
    `Set-Content -LiteralPath '.temp/handoff.md' -Value 'ready'`,
    `'ready' | Out-File -FilePath .temp/handoff.md`,
    `printf ready > .temp/handoff.md`,
    `echo ready >> './.temp/handoff.md'`,
  ])('recognizes a shell write of the note: %s', (command) => {
    expect(noteAtEnd([prompt('x'), shell(command), text('Ready.')])).toBe(true)
    expect(noteAtEnd([prompt('x'), { ...shell(command), name: 'Bash' }])).toBe(true)
    expect(noteAtEnd([prompt('x'), shell(command), prompt('go on')])).toBe(false)
  })

  it.each([
    `Get-Content .temp/handoff.md`,
    `cat .temp/handoff.md > docs/copy.md`,
    `Set-Content docs/other.md 'see .temp/handoff.md'`,
    `[IO.File]::WriteAllText('docs/other.md', '.temp/handoff.md')`,
    `echo 'Set-Content .temp/handoff.md'`,
    `echo 'ready > .temp/handoff.md'`,
    `Set-Content .temp/handoff.md.bak ready`,
    `Set-Content docs/handoff.md ready`,
  ])('does not treat a shell read or mention as writing the note: %s', (command) => {
    expect(noteAtEnd([prompt('x'), shell(command)])).toBe(false)
  })

  it('finds a shell write in the actual Codex CommandExecution feed', () => {
    const fold = new RolloutFold(Infinity, true)
    fold.push(JSON.stringify({ timestamp: at, type: 'event_msg', payload: { type: 'item_completed', item: {
      type: 'CommandExecution', command: ['pwsh', '-Command', `Set-Content .temp/handoff.md ready`], status: 'completed',
    } } }))
    expect(noteAtEnd(fold.summary().feed)).toBe(true)
  })

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
