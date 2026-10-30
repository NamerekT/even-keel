import { describe, expect, it } from 'vitest'
import type { MilestoneTask } from '../tracker/source.js'
import { changelogPrompt, materialOf, MAX_COMMENT_CHARS, type ChangelogRequest } from './draft.js'

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

const request = (fields: Partial<ChangelogRequest> = {}): ChangelogRequest => ({
  milestone: 'v0.1',
  mode: 'fresh',
  section: null,
  heading: '## [Unreleased]',
  tasks: [],
  released: [],
  previous: [],
  tags: [],
  file: 'docs/CHANGELOG.md',
  ...fields,
})

describe('changelogPrompt', () => {
  it('names the milestone, the format, the heading and the language source, and lists each task with its comment', () => {
    const prompt = changelogPrompt(
      request({ tasks: [task('ABC-1', { labels: ['Bug'], lastComment: 'Fixed the crash on start.' }), task('ABC-2', { parent: 'ABC-1' })] }),
    )
    expect(prompt).toContain('milestone v0.1')
    expect(prompt).toContain('Keep a Changelog')
    expect(prompt).toContain('`docs/CHANGELOG.md`')
    expect(prompt).toContain('README.md')
    expect(prompt).toContain('starting with its heading `## [Unreleased]`')
    expect(prompt).toContain('### ABC-1 · Title of ABC-1\nLabels: Bug\n\nFixed the crash on start.')
    expect(prompt).toContain('### ABC-2 · Title of ABC-2\nSubtask of ABC-1\n\n(no comment)')
    expect(prompt).not.toContain('## The section now')
  })

  it('forbids questions in every mode', () => {
    for (const mode of ['fresh', 'update', 'edit'] as const) {
      expect(changelogPrompt(request({ mode, section: '## [Unreleased]\n\n- A' }))).toContain('Ask no questions')
    }
  })

  it('gives an update the section and the tasks to work in, keeping the wording', () => {
    const prompt = changelogPrompt(request({ mode: 'update', section: '## [Unreleased]\n\n### Added\n\n- Mine', tasks: [task('ABC-3')] }))
    expect(prompt).toContain('## The section now\n\n## [Unreleased]\n\n### Added\n\n- Mine')
    expect(prompt).toContain('### ABC-3 · Title of ABC-3')
    expect(prompt).toContain('A task the section already describes needs nothing')
  })

  it('gives an edit the section and the user\'s words without tasks', () => {
    const prompt = changelogPrompt(request({ mode: 'edit', section: '## [Unreleased]\n\n- A', instruction: ' Shorter, please ', tasks: [task('ABC-3')] }))
    expect(prompt).toContain('## What the user asks\n\nShorter, please')
    expect(prompt).not.toContain('ABC-3')
  })

  it('lists the tags and the released sections to leave out', () => {
    const prompt = changelogPrompt(request({ heading: '## [0.1.1]', tags: ['v0.1.0'], released: ['## [0.1.0] - 2026-10-21\n\n- Old'] }))
    expect(prompt).toContain('Tags of the repository: v0.1.0.')
    expect(prompt).toContain('## Already released — leave out what this section describes\n\n## [0.1.0] - 2026-10-21\n\n- Old')
  })

  it('writes for a reader of the previous release in every mode: what the section adds gets no Fixed or Changed entries', () => {
    for (const mode of ['fresh', 'update', 'edit'] as const) {
      const prompt = changelogPrompt(request({ mode, section: '## [Unreleased]\n\n- A' }))
      expect(prompt).toContain('The reader upgrades from the release before this one')
      expect(prompt).toContain('Changed, Removed and Fixed are only for what that release already had')
    }
  })

  it('gives the release before as what the reader already has', () => {
    const prompt = changelogPrompt(request({ milestone: 'v0.2', previous: ['## [0.1.1]\n\n- A fix', '## [0.1.0]\n\n- First'] }))
    expect(prompt).toContain('## The release before — what the reader already has\n\n## [0.1.1]\n\n- A fix\n\n## [0.1.0]\n\n- First')
    expect(changelogPrompt(request())).not.toContain('## The release before')
  })

  it('cuts a long comment', () => {
    const prompt = changelogPrompt(request({ tasks: [task('ABC-1', { lastComment: 'x'.repeat(MAX_COMMENT_CHARS + 50) })] }))
    expect(prompt).toContain(`${'x'.repeat(MAX_COMMENT_CHARS)}…`)
    expect(prompt).not.toContain('x'.repeat(MAX_COMMENT_CHARS + 1))
  })
})
