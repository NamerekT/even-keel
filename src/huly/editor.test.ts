import { describe, expect, it, vi } from 'vitest'
import { EditRefused, revisionOf } from '../tracker/editor.js'
import { TrackerNotFound } from '../tracker/source.js'
import { hulyClient } from './client.js'
import { hulyEditor, type HulyEditorClient, type HulyFullIssue, type HulyNewIssue } from './editor.js'
import type { HulyMarkdown } from './marks.js'

const ISSUE = 'tracker:class:Issue'
const markdown = hulyClient.require<HulyMarkdown>('@hcengineering/text-markdown')
const STATUSES = [
  { _id: 'backlog', name: 'Backlog', category: 'task:statusCategory:UnStarted' },
  { _id: 'todo', name: 'Todo', category: 'task:statusCategory:ToDo' },
  { _id: 'done', name: 'Done', category: 'task:statusCategory:Won' },
]

function fixture() {
  const issue = (number: number, more: Partial<HulyFullIssue> = {}): HulyFullIssue => ({
    _id: `id-${number}`, identifier: `ABC-${number}`, title: `Task ${number}`, status: 'todo', space: 'space', priority: 3, ...more,
  })
  const issues = new Map([1, 2, 3].map((number) => [`ABC-${number}`, issue(number)]))
  issues.set('ABC-1', issue(1, { description: 'blob-1', milestone: 'm-old' }))
  issues.set('XYZ-1', issue(9, { identifier: 'XYZ-1', space: 'other' }))
  const blobs = new Map([['blob-1', '# Goal\n\nOne line.\n\n- a\n- b']])
  // As in live Huly: once a description was opened, the collaborator reads its own document and ignores the blob named.
  const docs = new Map([['id-1', '# Goal\n\nOne line.\n\n- a\n- b']])
  const updates: [string, Record<string, unknown>][] = []
  const updateDoc = vi.fn(async (_cls: string, _space: string, id: string, update: Record<string, unknown>) => {
    updates.push([id, update])
    const target = [...issues.values()].find((each) => each._id === id)!
    for (const [key, value] of Object.entries(update)) {
      if (key === '$push') for (const [field, ref] of Object.entries(value as object)) (target as Record<string, unknown[]>)[field] = [...((target as Record<string, unknown[]>)[field] ?? []), ref]
      else if (key === '$pull') for (const [field, ref] of Object.entries(value as object)) (target as Record<string, { _id: string }[]>)[field] = ((target as Record<string, { _id: string }[]>)[field] ?? []).filter((each) => each._id !== (ref as { _id: string })._id)
      else (target as Record<string, unknown>)[key] = value
    }
  })
  let uploads = 0
  const uploadMarkup = vi.fn(async (_cls: string, _id: string, _attribute: string, markup: string) => {
    const ref = `blob-new-${++uploads}`
    blobs.set(ref, markup)
    return ref
  })
  const updateMarkup = vi.fn(async (_cls: string, id: string, _attribute: string, markup: string) => {
    docs.set(id, markup)
  })
  const addCollection = vi.fn(async () => 'ref')
  const comments: string[] = []
  const client: HulyEditorClient = {
    findAll: async <T>(cls: string) => (cls.endsWith('TagElement') ? [{ _id: 'tag-bug', title: 'Bug', color: 1 }] : []) as T[],
    findOne: async <T>(cls: string, query: Record<string, unknown>) =>
      (cls === 'tracker:class:Milestone' ? (query.label === 'v1' ? { _id: 'm-v1' } : undefined) : { _id: 'category' }) as T | undefined,
    createDoc: async () => 'created',
    removeCollection: async () => undefined,
    addCollection,
    updateDoc,
    fetchMarkup: async (_cls, id, _attribute, markup) => docs.get(id) ?? blobs.get(markup) ?? '',
    uploadMarkup,
    updateMarkup,
  }
  const added: HulyNewIssue[] = []
  const editor = hulyEditor({
    client,
    markdown,
    findIssue: async (identifier) => {
      const found = issues.get(identifier)
      if (found === undefined) throw new TrackerNotFound(`huly: issue ${identifier} not found`)
      return found
    },
    spaceOf: async () => ({ _id: 'space', identifier: 'ABC' }),
    statusesOf: async () => ({ statuses: STATUSES, allowed: null }),
    issuesOf: async () => [],
    addIssue: async (_space, fields) => {
      added.push(fields)
      return { id: 'id-new', identifier: 'ABC-4' }
    },
    comment: async (_identifier, body) => {
      comments.push(body)
      return 'comment'
    },
  })
  const stored = (id = 'id-1') => docs.get(id)
  return { editor, issues, blobs, docs, stored, updates, uploadMarkup, updateMarkup, addCollection, added, comments }
}

const refusal = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work
  } catch (error) {
    if (error instanceof EditRefused) return error.message
    throw error
  }
  throw new Error('no refusal')
}

describe('hulyEditor', () => {
  it('creates a task in the backlog by default, under a parent of the project, with its milestone and labels', async () => {
    const { editor, added, addCollection } = fixture()
    const draft = { title: 'New', description: 'Text', status: null, priority: 'high' as const, milestone: 'v1', labels: ['bug'], parent: 'ABC-2' }
    expect(await editor.create('project', draft)).toBe('ABC-4')
    expect(added[0]).toMatchObject({ title: 'New', description: 'Text', status: 'backlog', priority: 'high', milestone: 'm-v1' })
    expect(added[0]!.parent?.identifier).toBe('ABC-2')
    expect(addCollection).toHaveBeenCalledWith('tags:class:TagReference', 'space', 'id-new', ISSUE, 'labels', { tag: 'tag-bug', title: 'Bug', color: 1 })
  })

  it('creates a task in a named status and refuses an unknown status, a missing milestone and a parent of another project', async () => {
    const { editor, added } = fixture()
    const draft = { title: 'New', description: '', status: 'todo', priority: null, milestone: null, labels: [], parent: null }
    await editor.create('project', draft)
    expect(added[0]).toMatchObject({ status: 'todo', priority: 'none', milestone: null, parent: null })
    expect(await refusal(editor.create('project', { ...draft, status: 'Later' }))).toMatch(/no status "Later"/)
    expect(await refusal(editor.create('project', { ...draft, milestone: 'v9' }))).toMatch(/no milestone "v9"/)
    expect(await refusal(editor.create('project', { ...draft, parent: 'XYZ-1' }))).toMatch(/XYZ-1 is of another project/)
    expect(added).toHaveLength(1)
  })

  it('sets short fields and says false when the field holds the value already', async () => {
    const { editor, updates } = fixture()
    expect(await editor.set('ABC-2', { field: 'title', to: 'Task 2' })).toBe(false)
    expect(await editor.set('ABC-2', { field: 'status', to: 'todo' })).toBe(false)
    expect(await editor.set('ABC-2', { field: 'priority', to: 'medium' })).toBe(false)
    expect(await editor.set('ABC-2', { field: 'milestone', to: null })).toBe(false)
    expect(updates).toEqual([])
    expect(await editor.set('ABC-2', { field: 'status', to: 'Done' })).toBe(true)
    expect(await editor.set('ABC-2', { field: 'priority', to: 'urgent' })).toBe(true)
    expect(await editor.set('ABC-1', { field: 'milestone', to: 'v1' })).toBe(true)
    expect(await editor.set('ABC-1', { field: 'milestone', to: null })).toBe(true)
    expect(updates).toEqual([['id-2', { status: 'done' }], ['id-2', { priority: 1 }], ['id-1', { milestone: 'm-v1' }], ['id-1', { milestone: null }]])
  })

  it('refuses to move a task under another parent, but not a parent it has already', async () => {
    const { editor, issues } = fixture()
    issues.get('ABC-3')!.parents = [{ parentId: 'id-2', identifier: 'ABC-2', parentTitle: 'Task 2', space: 'space' }]
    expect(await editor.set('ABC-3', { field: 'parent', to: 'abc-2' })).toBe(false)
    expect(await editor.set('ABC-2', { field: 'parent', to: null })).toBe(false)
    expect(await refusal(editor.set('ABC-3', { field: 'parent', to: null }))).toMatch(/^Huly: .*parent only on a new task/)
  })

  it('patches the description as Markdown in place, in the document the collaborator reads', async () => {
    const { editor, stored, updateMarkup, uploadMarkup, updates } = fixture()
    expect(await editor.patch('ABC-1', [{ old: 'One line.', new: 'Two lines.' }], '## Decisions\n\nNone yet.')).toBe(true)
    expect(updateMarkup).toHaveBeenCalledWith(ISSUE, 'id-1', 'description', '# Goal\n\nTwo lines.\n\n- a\n- b\n\n## Decisions\n\nNone yet.', 'markdown')
    expect(stored()).toContain('Two lines.')
    expect(await editor.patch('ABC-1', [{ old: 'One line.', new: 'Two lines.' }], '## Decisions\n\nNone yet.')).toBe(false)
    expect(updateMarkup).toHaveBeenCalledTimes(1)
    expect(uploadMarkup).not.toHaveBeenCalled()
    expect(updates).toEqual([])
    expect(await refusal(editor.patch('ABC-1', [{ old: '- ', new: '* ' }], null))).toMatch(/found 2 times/)
  })

  it('gives a task without a description a new markup of the issue', async () => {
    const { editor, issues, blobs, updateMarkup } = fixture()
    expect(await editor.patch('ABC-2', [], '## Decisions\n\nNone yet.')).toBe(true)
    expect(blobs.get(issues.get('ABC-2')!.description!)).toBe('## Decisions\n\nNone yet.')
    expect(updateMarkup).not.toHaveBeenCalled()
  })

  it('fails, not says it wrote, when the description reads back as it was', async () => {
    const { editor, updateMarkup } = fixture()
    updateMarkup.mockImplementation(async () => undefined)
    await expect(editor.patch('ABC-1', [], 'More.')).rejects.toThrow(/ABC-1: Huly did not save the description/)
    await expect(editor.describe('ABC-1', 'New text', await editor.revision('ABC-1'))).rejects.toThrow(/did not save/)
  })

  it('replaces the description whole only at its current revision', async () => {
    const { editor, updateMarkup } = fixture()
    const rev = await editor.revision('ABC-1')
    expect(await refusal(editor.describe('ABC-1', 'New text', rev + 1))).toMatch(/changed since rev/)
    expect(await editor.describe('ABC-1', '# Goal\r\n\r\nOne line.\r\n\r\n- a\r\n- b\r\n', rev)).toBe(false)
    expect(await editor.describe('ABC-1', 'New text', rev)).toBe(true)
    expect(updateMarkup).toHaveBeenCalledOnce()
    expect(await editor.revision('ABC-1')).toBe(revisionOf('New text'))
    expect(await editor.revision('ABC-2')).toBe(revisionOf(''))
  })

  it('writes inline code inside another mark fixed, says so, and takes a repeated patch for already so', async () => {
    const { editor, stored, updateMarkup } = fixture()
    const notes: string[] = []
    const patch = [{ old: 'One line.', new: 'Run **the `check` script**, see [the `run` guide](https://example.com/guide).' }]
    expect(await editor.patch('ABC-1', patch, '## Decisions\n\n_keep `x`_', notes)).toBe(true)
    expect(stored()).toBe('# Goal\n\nRun **the** `check` **script**, see [the run guide](https://example.com/guide).\n\n- a\n- b\n\n## Decisions\n\n_keep_ `x`')
    expect(notes).toEqual(['fixed 3 marks: code moved out of bold, italics; code mark removed inside a link'])
    const again: string[] = []
    expect(await editor.patch('ABC-1', patch, '## Decisions\n\n_keep `x`_', again)).toBe(false)
    expect(again).toEqual([])
    expect(updateMarkup).toHaveBeenCalledOnce()
  })

  it('fixes code a patch puts inside a mark already there, and takes its repeat for already so', async () => {
    const { editor, docs, stored, updateMarkup } = fixture()
    docs.set('id-1', 'Use **the npm script** here.')
    const notes: string[] = []
    expect(await editor.patch('ABC-1', [{ old: 'npm', new: '`npm`' }], null, notes)).toBe(true)
    expect(stored()).toBe('Use **the** `npm` **script** here.')
    expect(notes).toEqual(['fixed 1 mark: code moved out of bold'])
    expect(await editor.patch('ABC-1', [{ old: 'npm', new: '`npm`' }], null)).toBe(false)
    expect(updateMarkup).toHaveBeenCalledOnce()
  })

  it('replaces, creates and comments with the marks fixed, and says nothing of a clean text', async () => {
    const { editor, stored, added, comments } = fixture()
    const notes: string[] = []
    expect(await editor.describe('ABC-1', '**a `b`**', await editor.revision('ABC-1'), notes)).toBe(true)
    expect(stored()).toBe('**a** `b`')
    expect(await editor.describe('ABC-1', '**a `b`**', await editor.revision('ABC-1'), notes)).toBe(false)
    const draft = { title: 'New', description: '~~old `x`~~', status: null, priority: null, milestone: null, labels: [], parent: null }
    await editor.create('project', draft, notes)
    expect(added[0]!.description).toBe('~~old~~ `x`')
    await editor.comment('ABC-1', 'Done in [`src/a.ts`](https://example.com/a)', null, notes)
    expect(comments).toEqual(['Done in [src/a.ts](https://example.com/a)'])
    expect(notes).toEqual([
      'fixed 1 mark: code moved out of bold',
      'fixed 1 mark: code moved out of strikethrough',
      'fixed 1 mark: code mark removed inside a link',
    ])
    const clean: string[] = []
    await editor.comment('ABC-1', '**Done** in `src/a.ts`', null, clean)
    await editor.create('project', { ...draft, description: '* a\n* b' }, clean)
    expect(comments[1]).toBe('**Done** in `src/a.ts`')
    expect(added[1]!.description).toBe('* a\n* b')
    expect(clean).toEqual([])
  })

  it('links by blockedBy of the blocked issue and relations on both sides, once', async () => {
    const { editor, issues, updates } = fixture()
    await editor.link('ABC-1', 'ABC-2', 'blocks', true)
    await editor.link('ABC-1', 'ABC-2', 'blocks', true)
    await editor.link('ABC-1', 'ABC-3', 'blockedBy', true)
    await editor.link('ABC-1', 'XYZ-1', 'relates', true)
    expect(issues.get('ABC-2')!.blockedBy).toEqual([{ _id: 'id-1', _class: ISSUE }])
    expect(issues.get('ABC-1')!.blockedBy).toEqual([{ _id: 'id-3', _class: ISSUE }])
    expect(issues.get('ABC-1')!.relations).toEqual([{ _id: 'id-9', _class: ISSUE }])
    expect(issues.get('XYZ-1')!.relations).toEqual([{ _id: 'id-1', _class: ISSUE }])
    expect(updates).toHaveLength(4)
    await editor.link('XYZ-1', 'ABC-1', 'relates', false)
    await editor.link('ABC-2', 'ABC-1', 'blockedBy', false)
    await editor.link('ABC-2', 'ABC-1', 'blockedBy', false)
    expect(issues.get('ABC-1')!.relations).toEqual([])
    expect(issues.get('XYZ-1')!.relations).toEqual([])
    expect(issues.get('ABC-2')!.blockedBy).toEqual([])
    expect(updates).toHaveLength(7)
    expect(await refusal(editor.link('ABC-1', 'ABC-1', 'relates', true))).toMatch(/cannot be linked to itself/)
  })
})

describe("a patched description through Huly's markup", () => {
  // The way a patch goes: Markdown → the markup uploaded → the Markdown read back (BTN-779).
  const trip = (markdown: string): string => {
    const { markdownToMarkup, markupToMarkdown } = hulyClient.require<{ markdownToMarkup(text: string): unknown; markupToMarkdown(json: unknown): string }>('@hcengineering/text-markdown')
    const { markupToJSON, jsonToMarkup } = hulyClient.require<{ markupToJSON(markup: string): unknown; jsonToMarkup(json: unknown): string }>('@hcengineering/text-core')
    return markupToMarkdown(markupToJSON(jsonToMarkup(markdownToMarkup(markdown))))
  }

  it('keeps headings, lists, code, quotes, links, marks and checklists as they are', () => {
    const text = [
      'Decided on **2026-11-06**: after the `v0.3` cut — see [the guide](https://example.com/guide).',
      '## Why',
      '- one with *emphasis* and ~~strike~~\n  - nested',
      '1. first\n2. second',
      '> a quote',
      '```ts\nconst a = 1 // code\n```',
      '- [ ] open\n- [x] done',
    ].join('\n\n')
    expect(trip(text)).toBe(text)
  })

  it('reads a table back as HTML, which settles after one more blank line', () => {
    const once = trip('Before\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter')
    expect(once).toContain('<table>')
    const twice = trip(once)
    expect(twice).toBe(once.replace('</table>\n\n', '</table>\n\n\n\n'))
    expect(trip(twice)).toBe(twice)
  })
})
