import { describe, expect, it } from 'vitest'
import type { MilestoneTask } from '../tracker/source.js'
import { changelogPrompt, materialOf, MAX_COMMENT_CHARS } from './draft.js'

const DONE = { name: 'Done', category: 'Won' } as const
const OPEN = { name: 'Todo', category: 'ToDo' } as const
const CANCELED = { name: 'Canceled', category: 'Lost' } as const

const task = (id: string, fields: Partial<MilestoneTask> = {}): MilestoneTask => ({
  id,
  title: `Title of ${id}`,
  status: DONE,
  blockedBy: [],
  parent: null,
  subtasks: 0,
  milestone: { label: 'v0.1', targetDate: null },
  priority: 'none',
  labels: [],
  estimate: null,
  lastComment: null,
  ...fields,
})

describe('materialOf', () => {
  it('takes the done tasks by number and counts the open ones, leaving canceled ones out', () => {
    const material = materialOf('v0.1', [task('ABC-10'), task('ABC-2'), task('ABC-3', { status: OPEN }), task('ABC-4', { status: CANCELED })])
    expect(material.done.map((each) => each.id)).toEqual(['ABC-2', 'ABC-10'])
    expect(material.open).toBe(1)
  })
})

describe('changelogPrompt', () => {
  it('names the milestone, the format and the language source, and lists each task with its comment', () => {
    const prompt = changelogPrompt(
      materialOf('v0.1', [
        task('ABC-1', { labels: ['Bug'], lastComment: 'Fixed the crash on start.' }),
        task('ABC-2', { parent: 'ABC-1' }),
      ]),
    )
    expect(prompt).toContain('milestone v0.1')
    expect(prompt).toContain('Keep a Changelog')
    expect(prompt).toContain('CHANGELOG.md')
    expect(prompt).toContain('README.md')
    expect(prompt).toContain('Unreleased')
    expect(prompt).toContain('### ABC-1 · Title of ABC-1\nLabels: Bug\n\nFixed the crash on start.')
    expect(prompt).toContain('### ABC-2 · Title of ABC-2\nSubtask of ABC-1\n\n(no comment)')
  })

  it('cuts a long comment', () => {
    const prompt = changelogPrompt(materialOf('v0.1', [task('ABC-1', { lastComment: 'x'.repeat(MAX_COMMENT_CHARS + 50) })]))
    expect(prompt).toContain(`${'x'.repeat(MAX_COMMENT_CHARS)}…`)
    expect(prompt).not.toContain('x'.repeat(MAX_COMMENT_CHARS + 1))
  })
})
