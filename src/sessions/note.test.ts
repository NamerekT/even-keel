import { describe, expect, it } from 'vitest'
import { handoffNoteOf, noteAtEnd, noteFileOf, noteWritten } from './note.js'
import { mailMessage } from './mail.js'
import { TranscriptFold, type FeedLine } from './transcript.js'
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

  it('keeps the note of a turn that a message from the chat reached mid-turn (BTN-1718)', () => {
    const mid: FeedLine = { at, kind: 'prompt', text: 'Reply with the word PONG.', midTurn: true }
    expect(noteWritten([prompt('/handoff'), tool('mcp__tasks__handoff_write'), mid, text('Done.')])).toBe('handoff_write')
    expect(noteAtEnd([prompt('x'), note(), { ...mid, kind: 'answer' }, text('Done.')])).toBe(true)
  })

  it('finds the note in a Claude transcript past a message the inbox socket gave the running turn', () => {
    const stamp = (n: number) => `2026-11-25T22:37:${String(n).padStart(2, '0')}.000Z`
    const mail = { id: 31, task: 'ABC-22', session: 's1', text: 'Reply with the word PONG.', files: [], sentAt: at, fate: 'delivered' as const, event: null, settledAt: null }
    const peer = `<peer-message from="inbox">\n${mailMessage([mail], 'inbox', 'en')}\n</peer-message>`
    const assistant = (n: number, content: unknown[]) => JSON.stringify({ type: 'assistant', timestamp: stamp(n), message: { id: `m${n}`, role: 'assistant', content } })
    const fold = new TranscriptFold(Infinity, true)
    for (const line of [
      JSON.stringify({ type: 'user', timestamp: stamp(1), message: { role: 'user', content: '/handoff' } }),
      assistant(2, [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__plugin_tasks_tasks__handoff_write', input: { text: 'notes' } }]),
      JSON.stringify({ type: 'attachment', timestamp: stamp(3), attachment: { type: 'queued_command', prompt: peer, commandMode: 'prompt', origin: { kind: 'peer' } } }),
      JSON.stringify({ type: 'user', timestamp: stamp(4), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'saved' }] } }),
      assistant(5, [{ type: 'text', text: 'PONG' }]),
    ]) fold.push(line)
    const feed = fold.summary().feed
    expect(feed.filter((line) => line.kind === 'prompt').map((line) => line.text)).toEqual(['/handoff', 'Reply with the word PONG.'])
    expect(noteWritten(feed)).toBe('handoff_write')
  })

  it('ignores other files named handoff and reads of the note', () => {
    expect(noteAtEnd([prompt('x'), note('docs/handoff.md')])).toBe(false)
    expect(noteAtEnd([prompt('x'), tool('Read', '.temp/handoff.md')])).toBe(false)
  })
})

describe('the note of a task (BTN-964)', () => {
  it('is the shared name in a git project and one of its own per task in a project without git', () => {
    expect(noteFileOf('ABC-12', true)).toBe('.temp/handoff.md')
    expect(noteFileOf('ABC-12', false)).toBe('.temp/handoff-ABC-12.md')
    expect(noteFileOf('octo/app#7', false)).toBe('.temp/handoff-octo-app-7.md')
  })

  it('is recognized by its own name and given back as written', () => {
    expect(noteWritten([prompt('x'), note('C:\\data\\notes\\.temp\\handoff-ABC-12.md')])).toBe('.temp/handoff-ABC-12.md')
    expect(noteWritten([prompt('x'), { ...tool('Shell'), detail: `Set-Content .temp/handoff-ABC-3.md ready` }])).toBe('.temp/handoff-ABC-3.md')
    expect(noteWritten([prompt('x'), note()])).toBe('.temp/handoff.md')
    expect(noteWritten([prompt('x'), note('.temp/handoff-ABC-12.md.bak')])).toBeNull()
    expect(noteWritten([prompt('x'), tool('Bash', 'test')])).toBeNull()
  })
})

describe('the note kept with Even Keel (BTN-1046)', () => {
  it('goes through the tasks server when the project has it, else to the task note file', () => {
    expect(handoffNoteOf('ABC-12', true, true)).toBe('handoff_write')
    expect(handoffNoteOf('ABC-12', false, true)).toBe('handoff_write')
    expect(handoffNoteOf('ABC-12', false, false)).toBe('.temp/handoff-ABC-12.md')
  })

  it('is recognized by the tool call under any agent name of it near the end of the turn', () => {
    for (const name of ['mcp__plugin_tasks_tasks__handoff_write', 'mcp__tasks__handoff_write', 'tasks.handoff_write', 'handoff_write']) {
      expect(noteWritten([prompt('x'), tool(name), text('Kept.')])).toBe('handoff_write')
    }
    expect(noteWritten([prompt('x'), tool('mcp__tasks__handoff_write_old')])).toBeNull()
    expect(noteWritten([prompt('x'), tool('mcp__tasks__handoff_write'), prompt('go on')])).toBeNull()
  })
})
