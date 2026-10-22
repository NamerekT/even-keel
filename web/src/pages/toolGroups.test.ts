import { describe, expect, it } from 'vitest'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import { editTotals, feedEntries, summarize, toolKind } from './toolGroups.js'

const minute = (value: number) => new Date(Date.UTC(2026, 0, 1, 12, value)).toISOString()
const text = (at: number, value = 'note'): FeedLine => ({ at: minute(at), kind: 'text', text: value })
const call = (at: number, name: string, id: string, extra: Partial<FeedLine> = {}): FeedLine => ({ at: minute(at), kind: 'tool', text: name, name, tool: id, ...extra })

describe('feedEntries', () => {
  it('puts the calls between two texts into one group', () => {
    const entries = feedEntries([text(0), call(0, 'Read', 'a'), call(1, 'Edit', 'b'), text(1), call(2, 'Bash', 'c')])
    expect(entries.map((entry) => (entry.kind === 'tools' ? entry.calls.map((each) => each.line.tool) : entry.kind))).toEqual([
      'line',
      ['a', 'b'],
      'line',
      ['c'],
    ])
  })

  it('folds the image and the failed line of a call into it, and keeps them when the call is unknown', () => {
    const entries = feedEntries([
      call(0, 'Read', 'a'),
      call(0, 'Bash', 'b'),
      { at: minute(0), kind: 'image', text: 'shot.png', tool: 'a', images: 1 },
      { at: minute(0), kind: 'failed', text: 'Exit code 1', tool: 'b' },
      { at: minute(0), kind: 'failed', text: 'lost', tool: 'z' },
    ])
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ kind: 'tools', calls: [{ failure: null }, { failure: 'Exit code 1' }] })
    expect(entries[1]).toMatchObject({ kind: 'line', line: { kind: 'failed', text: 'lost' } })
  })

  it('lets a question break the group', () => {
    const ask: FeedLine = { ...call(0, 'AskUserQuestion', 'q'), ask: { id: 'q', questions: [] } }
    const entries = feedEntries([call(0, 'Read', 'a'), ask, call(0, 'Read', 'b')])
    expect(entries.map((entry) => entry.kind)).toEqual(['tools', 'line', 'tools'])
  })

  it('lets files the session sent the user break the group', () => {
    const share: FeedLine = { ...call(0, 'SendUserFile', 'audit'), share: { caption: 'Audit', files: ['a.md'], folder: 'C:\\repo' } }
    const entries = feedEntries([call(0, 'Read', 'a'), share, call(0, 'Read', 'b')])
    expect(entries.map((entry) => entry.kind)).toEqual(['tools', 'line', 'tools'])
  })

  it('puts a time mark between events more than five minutes apart', () => {
    const entries = feedEntries([text(0), call(1, 'Read', 'a'), call(9, 'Read', 'b'), text(14), text(20)])
    expect(entries.map((entry) => (entry.kind === 'gap' ? `gap ${entry.at}` : entry.kind))).toEqual([
      'line',
      'tools',
      'line',
      `gap ${minute(20)}`,
      'line',
    ])
  })
})

describe('summarize', () => {
  it('counts files once, calls of the rest, failures and the lines edited', () => {
    const summary = summarize(
      [
        call(0, 'Edit', 'a', { subject: 'C:/w/a.ts', added: 3, removed: 1 }),
        call(0, 'Edit', 'b', { subject: 'C:/w/a.ts', added: 1, removed: 0 }),
        call(0, 'Write', 'c', { subject: 'C:/w/b.ts', added: 5, removed: 0 }),
        call(0, 'Read', 'd', { subject: 'C:/w/a.ts' }),
        call(0, 'Grep', 'e'),
        call(0, 'Bash', 'f'),
        call(0, 'Shell', 'g'),
        call(0, 'mcp__huly__get_issue', 'h'),
      ].map((line) => ({ line, failure: line.tool === 'f' ? 'Exit code 1' : null })),
    )
    expect(summary).toEqual({ counts: { edit: 2, read: 1, search: 1, run: 2, other: 1 }, failed: 1, size: { added: 9, removed: 1 } })
  })

  it('has no size when no call edits', () => {
    expect(summarize([{ line: call(0, 'Read', 'a'), failure: null }]).size).toBeNull()
  })
})

describe('toolKind', () => {
  it('sorts the tools of both agents', () => {
    expect(['Edit', 'MultiEdit', 'NotebookEdit', 'Write', 'Read', 'Grep', 'Glob', 'Bash', 'PowerShell', 'Shell', 'Skill', undefined].map(toolKind)).toEqual([
      'edit',
      'edit',
      'edit',
      'edit',
      'read',
      'search',
      'search',
      'run',
      'run',
      'run',
      'other',
      'other',
    ])
  })
})

describe('editTotals', () => {
  it('sums the edits of the transcript, null without any', () => {
    expect(editTotals([call(0, 'Edit', 'a', { added: 2, removed: 1 }), text(0), call(0, 'Write', 'b', { added: 4, removed: 0 })])).toEqual({ added: 6, removed: 1 })
    expect(editTotals([text(0), call(0, 'Read', 'a')])).toBeNull()
  })
})
