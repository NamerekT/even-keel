import { describe, expect, it } from 'vitest'
import { hulyClient } from './client.js'
import { hulyImport, type HulyImportClient } from './import.js'
import { hulyText } from './import-text.js'

const textCore = hulyClient.require<{ jsonToMarkup(json: unknown): string; markupToJSON(markup: string): unknown }>('@hcengineering/text-core')
const textMarkdown = hulyClient.require<{ markupToMarkdown(json: unknown): string }>('@hcengineering/text-markdown')
const markup = { markupToJSON: textCore.markupToJSON, markupToMarkdown: (json: unknown) => textMarkdown.markupToMarkdown(json) }

const ISSUE = 'tracker:class:Issue'
const doc = (...content: unknown[]) => textCore.jsonToMarkup({ type: 'doc', content })
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content })
const text = (value: string) => ({ type: 'text', text: value })
const reference = (id: string, objectclass: string, label: string) => ({ type: 'reference', attrs: { id, objectclass, label } })
const image = (blob: string, alt: string) => ({ type: 'image', attrs: { 'file-id': blob, src: '', alt, width: 300 } })

function fixture() {
  const tables: Record<string, Record<string, unknown>[]> = {
    'tracker:class:IssueStatus': [
      { _id: 'todo', name: 'Todo', category: 'task:statusCategory:ToDo' },
      { _id: 'done', name: 'Done', category: 'task:statusCategory:Won' },
      { _id: 'canceled', name: 'Canceled', category: 'task:statusCategory:Lost' },
    ],
    [ISSUE]: [
      {
        _id: 'id-1', identifier: 'ABC-1', number: 1, title: 'First', status: 'done', space: 'space', priority: 2, milestone: 'm1', component: 'c1',
        labels: 1, estimation: 0.5, createdOn: 1000, createdBy: 'social-agent', attachedTo: 'tracker:ids:NoParent', description: 'blob-1',
        relations: [{ _id: 'id-2', _class: ISSUE }], blockedBy: [{ _id: 'id-x9', _class: ISSUE }],
      },
      { _id: 'id-2', identifier: 'ABC-2', number: 2, title: 'Second', status: 'todo', space: 'space', createdOn: 2000, createdBy: 'social-other', attachedTo: 'id-1', blockedBy: [{ _id: 'id-1', _class: ISSUE }], relations: [{ _id: 'id-1', _class: ISSUE }] },
      { _id: 'id-3', identifier: 'ABC-3', number: 3, title: 'Third', status: 'canceled', space: 'space', createdOn: 3000, createdBy: 'social-user', relations: [{ _id: 'id-x9', _class: ISSUE }, { _id: 'id-gone', _class: ISSUE }] },
      { _id: 'id-x9', identifier: 'XYZ-9', number: 9, title: 'Elsewhere', status: 'todo', space: 'other' },
    ],
    'tracker:class:Milestone': [{ _id: 'm1', label: 'v1', space: 'space' }],
    'tracker:class:Component': [{ _id: 'c1', label: 'UI', space: 'space' }],
    'tags:class:TagReference': [{ attachedTo: 'id-1', title: 'Bug' }],
    'contact:class:SocialIdentity': [
      { _id: 'social-agent', attachedTo: 'person-agent' },
      { _id: 'social-agent2', attachedTo: 'person-agent' },
      { _id: 'social-user', attachedTo: 'person-user' },
      { _id: 'social-other', attachedTo: 'person-other' },
    ],
    'contact:class:Person': [
      { _id: 'person-agent', name: 'Code,Claude' },
      { _id: 'person-user', name: 'Doe,John' },
      { _id: 'person-other', name: 'Roe,Jane' },
    ],
    'chunter:class:ChatMessage': [
      { _id: 'c2', attachedTo: 'id-1', createdOn: 4000, createdBy: 'social-agent2', message: doc(paragraph(text('Done.'))) },
      { _id: 'c1', attachedTo: 'id-1', createdOn: 2000, createdBy: 'social-user', message: doc(paragraph(text('Look:')), image('blob-img2', 'shot.png')) },
    ],
    'chunter:class:ThreadMessage': [{ _id: 'r1', attachedTo: 'c1', createdOn: 3000, createdBy: 'social-other', message: doc(paragraph(text('Seen.'))) }],
    'attachment:class:Attachment': [
      { attachedTo: 'c1', file: 'blob-img2', name: 'shot.png', type: 'image/png', size: 4, createdOn: 2000, modifiedOn: 2000 },
      { attachedTo: 'id-1', file: 'blob-a1', name: 'log.txt', type: 'text/plain', size: 3, createdOn: 1500, modifiedOn: 1500 },
    ],
    'activity:class:DocUpdateMessage': [
      { _id: 'u0', attachedTo: 'id-1', objectId: 'id-1', objectClass: ISSUE, action: 'create', createdOn: 1000, createdBy: 'social-agent' },
      { _id: 'u1', attachedTo: 'id-1', objectId: 'id-1', objectClass: ISSUE, action: 'update', createdOn: 5000, createdBy: 'social-agent', attributeUpdates: { attrKey: 'status', set: ['done'], prevValue: 'todo' } },
      { _id: 'u2', attachedTo: 'id-1', objectId: 'id-1', objectClass: ISSUE, action: 'update', createdOn: 1200, createdBy: 'social-user', attributeUpdates: { attrKey: 'priority', set: [2], prevValue: 3 } },
      { _id: 'u3', attachedTo: 'id-1', objectId: 'id-1', objectClass: ISSUE, action: 'update', createdOn: 1300, createdBy: 'social-user', attributeUpdates: { attrKey: 'blockedBy', set: [], added: [{ _id: 'id-x9', _class: ISSUE }], removed: [] } },
      { _id: 'u4', attachedTo: 'id-1', objectId: 'id-1', objectClass: ISSUE, action: 'update', createdOn: 1400, createdBy: 'social-user', attributeUpdates: { attrKey: 'estimation', set: [0.5], prevValue: 0 } },
      { _id: 'u5', attachedTo: 'id-1', objectId: 'id-1', objectClass: ISSUE, action: 'update', createdOn: 1450, createdBy: 'social-user', attributeUpdates: { attrKey: 'assignee', set: ['someone'] } },
      { _id: 'u6', attachedTo: 'id-1', objectId: 'id-1', objectClass: ISSUE, action: 'update', createdOn: 1460, createdBy: 'social-other', attributeUpdates: { attrKey: 'milestone', set: ['m1'], prevValue: null } },
      { _id: 'u7', attachedTo: 'id-3', objectId: 'id-3', objectClass: ISSUE, action: 'update', createdOn: 7000, createdBy: 'social-user', attributeUpdates: { attrKey: 'status', set: ['canceled'], prevValue: 'todo' } },
    ],
  }
  const markups: Record<string, string> = {
    'blob-1': doc(
      paragraph(text('See '), reference('person-user', 'contact:class:Person', 'John Doe'), text(' and '), reference('id-2', ISSUE, 'ABC-2')),
      image('blob-img1', 'diagram.png'),
    ),
  }
  const blobs: Record<string, Uint8Array> = { 'blob-a1': new Uint8Array([1, 2, 3]) }
  const matches = (row: Record<string, unknown>, query: Record<string, unknown>) =>
    Object.entries(query).every(([key, wanted]) =>
      wanted !== null && typeof wanted === 'object' && '$in' in wanted ? (wanted.$in as unknown[]).includes(row[key]) : row[key] === wanted,
    )
  const queries: string[] = []
  const client: HulyImportClient = {
    findAll: async <T>(cls: string, query: Record<string, unknown>) => {
      queries.push(cls)
      return (tables[cls] ?? []).filter((row) => matches(row, query)) as T[]
    },
    fetchMarkup: async (_cls, _id, _attribute, ref) => markups[ref] ?? '',
  }
  const source = hulyImport({
    client,
    markup,
    space: { _id: 'space', createdBy: 'social-user' },
    ownSocialId: 'social-agent',
    readFile: async (blob) => {
      const bytes = blobs[blob]
      if (bytes === undefined) throw new Error(`no blob ${blob}`)
      return (async function* () {
        yield bytes.slice(0, 1)
        yield bytes.slice(1)
      })()
    },
  })
  return { source, queries, tables }
}

describe('hulyText', () => {
  it('stands a stored picture as its ref and a reference as its label', () => {
    const json = textCore.markupToJSON(
      doc(paragraph(text('Ask '), reference('p', 'contact:class:Person', 'John Doe'), text(' about '), reference('i', ISSUE, 'ABC-7')), image('blob-x', '')),
    )
    const { markdown, images } = hulyText(json, markup.markupToMarkdown)
    expect(markdown).toContain('Ask John Doe about ABC-7')
    expect(markdown).toContain('![](huly-image:blob-x)')
    expect(markdown).not.toMatch(/ref:\/\/|image:\/\//)
    expect(images).toEqual([{ ref: 'huly-image:blob-x', blob: 'blob-x', name: 'image-1' }])
  })

  it('keeps a picture of an outside address as it is', () => {
    const json = textCore.markupToJSON(doc({ type: 'image', attrs: { src: 'https://example.com/a.png', alt: 'a' } }))
    const { markdown, images } = hulyText(json, markup.markupToMarkdown)
    expect(markdown).toContain('![a](https://example.com/a.png)')
    expect(images).toEqual([])
  })
})

describe('hulyImport', () => {
  it('reads every task of the project, closed ones too, with its fields and links', async () => {
    const tasks = await fixture().source.tasks()
    expect(tasks.map((task) => task.id)).toEqual(['ABC-1', 'ABC-2', 'ABC-3'])
    const [first, second, third] = tasks
    expect(first).toMatchObject({
      ref: 'id-1', number: 1, title: 'First', status: { name: 'Done', category: 'Won' }, priority: 'high', milestone: 'v1', component: 'UI',
      labels: ['Bug'], estimate: 30, parent: null, createdAt: 1000, createdBy: { kind: 'agent', name: 'Claude Code' }, closedAt: 5000,
      blocks: [{ ref: 'id-2', id: 'ABC-2', foreign: false }],
      blockedBy: [{ ref: 'id-x9', id: 'XYZ-9', foreign: true }],
      related: [{ ref: 'id-2', id: 'ABC-2', foreign: false }],
      images: [{ ref: 'huly-image:blob-img1', file: 'blob-img1' }],
    })
    expect(first!.description).toContain('See John Doe and ABC-2')
    expect(first!.description).toContain('![diagram.png](huly-image:blob-img1)')
    expect(second).toMatchObject({
      parent: { ref: 'id-1', id: 'ABC-1', foreign: false }, blockedBy: [{ ref: 'id-1', id: 'ABC-1', foreign: false }], blocks: [],
      createdBy: { kind: 'person', name: 'Jane Roe' }, closedAt: null, priority: 'none', milestone: null, component: null, estimate: null, description: '',
    })
    // A link to an issue that is gone is no link.
    expect(third).toMatchObject({ status: { category: 'Lost' }, related: [{ ref: 'id-x9', id: 'XYZ-9', foreign: true }], closedAt: 7000, createdBy: { kind: 'user', name: 'John Doe' } })
  })

  it('reads the journal oldest first, a reply with the comment it answers', async () => {
    const comments = await fixture().source.comments('id-1')
    expect(comments.map(({ ref, author, at, files, replyTo }) => ({ ref, author, at, files, replyTo }))).toEqual([
      { ref: 'c1', author: { kind: 'user', name: 'John Doe' }, at: 2000, files: ['blob-img2'], replyTo: null },
      { ref: 'r1', author: { kind: 'person', name: 'Jane Roe' }, at: 3000, files: [], replyTo: 'c1' },
      // Another social id of the same person is the same author.
      { ref: 'c2', author: { kind: 'agent', name: 'Claude Code' }, at: 4000, files: [], replyTo: null },
    ])
    expect(comments[0]!.body).toContain('![shot.png](huly-image:blob-img2)')
    expect(comments[0]!.images).toEqual([{ ref: 'huly-image:blob-img2', file: 'blob-img2' }])
  })

  it('gives each file once: the attachments, then the pictures that are no attachment', async () => {
    const files = await fixture().source.files('id-1')
    expect(files.map(({ key, name, type, size }) => ({ key, name, type, size }))).toEqual([
      { key: 'blob-a1', name: 'log.txt', type: 'text/plain', size: 3 },
      { key: 'blob-img2', name: 'shot.png', type: 'image/png', size: 4 },
      { key: 'blob-img1', name: 'diagram.png', type: '', size: null },
    ])
    expect(await files[0]!.read()).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('reads the change log by name, oldest first, without the fields it does not know', async () => {
    const changes = await fixture().source.changes!('id-1')
    expect(changes).toEqual([
      { at: 1200, author: { kind: 'user', name: 'John Doe' }, field: 'priority', from: 'medium', to: 'high' },
      { at: 1300, author: { kind: 'user', name: 'John Doe' }, field: 'blockedBy', from: null, to: 'XYZ-9' },
      { at: 1400, author: { kind: 'user', name: 'John Doe' }, field: 'estimate', from: null, to: '30' },
      { at: 1460, author: { kind: 'person', name: 'Jane Roe' }, field: 'milestone', from: null, to: 'v1' },
      { at: 5000, author: { kind: 'agent', name: 'Claude Code' }, field: 'status', from: 'Todo', to: 'Done' },
    ])
  })

  it("gives a task's last change: its own, its activity's, its comments' and replies' and its files'", async () => {
    const { source, tables } = fixture()
    tables[ISSUE]![0]!.modifiedOn = 1100
    tables[ISSUE]![1]!.modifiedOn = 2500
    tables[ISSUE]![2]!.modifiedOn = 3000
    tables['chunter:class:ChatMessage']![0]!.lastReply = 8000
    tables['attachment:class:Attachment']!.push({ attachedTo: 'c2', file: 'blob-late', name: 'late.txt', createdOn: 9500, modifiedOn: 9500 })
    tables['chunter:class:ChatMessage']!.push({ _id: 'c9', attachedTo: 'id-2', createdOn: 2600, modifiedOn: 2700, createdBy: 'social-user', message: doc(paragraph(text('Hi.'))) })
    const [first, second, third] = await source.tasks()
    expect([first!.modifiedAt, second!.modifiedAt, third!.modifiedAt]).toEqual([9500, 2700, 7000])
    expect((await fixture().source.tasks())[0]!.modifiedAt).toBe(5000)
  })

  it("reads a task's thread once for its comments and files", async () => {
    const { source, queries } = fixture()
    await source.tasks()
    const before = queries.filter((cls) => cls === 'chunter:class:ChatMessage').length
    await source.comments('id-1')
    await source.files('id-1')
    expect(queries.filter((cls) => cls === 'chunter:class:ChatMessage').length).toBe(before + 1)
  })

  it('reads the project once for all its tasks', async () => {
    const { source, queries } = fixture()
    await source.tasks()
    const before = queries.length
    await source.changes!('id-1')
    await source.tasks()
    expect(queries.length).toBe(before)
  })
})
