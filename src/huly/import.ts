import type { ImportAuthor, ImportChange, ImportComment, ImportFile, ImportLink, ImportSource, ImportTask } from '../tracker/import.js'
import { tracker } from './ids.js'
import { hulyText, type HulyImage, type HulyText } from './import-text.js'
import { HULY_PRIORITIES, personName, toStatus, type HulyAttachmentDoc, type HulyStatusDoc } from './model.js'

type Query = Record<string, unknown>

export interface HulyImportClient {
  findAll<T>(cls: string, query: Query, options?: { projection?: Record<string, 1> }): Promise<T[]>
  fetchMarkup(cls: string, id: string, attribute: string, markup: string, format: 'markup'): Promise<string>
}

export interface HulyImportDeps {
  client: HulyImportClient
  markup: { markupToJSON(markup: string): unknown; markupToMarkdown(json: unknown): string }
  /** The Huly project; its creator is taken for the user. */
  space: { _id: string; createdBy?: string }
  /** The primary social id of the account Even Keel signs in with: what its person wrote is the agent's. */
  ownSocialId: string
  readFile(blob: string): Promise<AsyncIterable<Uint8Array>>
}

interface IssueDoc {
  _id: string
  identifier: string
  number?: number
  title: string
  status: string
  description?: string | null
  priority?: number
  milestone?: string | null
  component?: string | null
  labels?: number
  estimation?: number
  attachedTo?: string
  blockedBy?: { _id: string }[]
  relations?: { _id: string; _class: string }[]
  createdOn?: number
  createdBy?: string
}

interface MessageDoc {
  _id: string
  attachedTo?: string
  message: string
  createdBy?: string
  createdOn: number
}

/** Huly's activity record of a change (`activity:class:DocUpdateMessage`). */
interface UpdateDoc {
  attachedTo: string
  objectId?: string
  action?: string
  createdBy?: string
  createdOn: number
  attributeUpdates?: { attrKey: string; set?: unknown[]; prevValue?: unknown; added?: unknown[]; removed?: unknown[] }
}

interface Project {
  tasks: ImportTask[]
  updates: ReadonlyMap<string, UpdateDoc[]>
  images: ReadonlyMap<string, HulyImage[]>
  names: Names
}

interface Names {
  status: ReadonlyMap<string, string>
  milestone: ReadonlyMap<string, string>
  component: ReadonlyMap<string, string>
  /** The identifier of every issue known, the project's and the linked ones. */
  issue: ReadonlyMap<string, string>
}

const UPDATE = 'activity:class:DocUpdateMessage'
const TAG_REFERENCE = 'tags:class:TagReference'
const CHAT_MESSAGE = 'chunter:class:ChatMessage'
const THREAD_MESSAGE = 'chunter:class:ThreadMessage'
const ATTACHMENT = 'attachment:class:Attachment'
const SOCIAL_IDENTITY = 'contact:class:SocialIdentity'
const PERSON = 'contact:class:Person'
const NO_PARENT = tracker.ids.NoParent
const CLOSED = new Set(['Won', 'Lost'])
/** The longest `$in` list of one query, and how many descriptions are fetched at once. */
const CHUNK = 200
const PARALLEL = 8

/**
 * The import's read of a Huly project (BTN-1402): every issue, its comments with the replies in their threads, its
 * files and the change log Huly's activity keeps. The project is read once, on the first call; comments and files a
 * task at a time.
 */
export function hulyImport(deps: HulyImportDeps): ImportSource {
  const { client, markup, space } = deps
  const textOf = (value: string): HulyText => hulyText(markup.markupToJSON(value), markup.markupToMarkdown)
  const authors = authorsOf(client, deps.ownSocialId, space.createdBy)

  let loading: Promise<Project> | null = null
  const project = () =>
    (loading ??= load().catch((error: unknown) => {
      loading = null
      throw error
    }))

  async function load(): Promise<Project> {
    const [statuses, issues, milestones, components] = await Promise.all([
      client.findAll<HulyStatusDoc>(tracker.class.IssueStatus, {}),
      client.findAll<IssueDoc>(tracker.class.Issue, { space: space._id }),
      client.findAll<{ _id: string; label: string }>(tracker.class.Milestone, { space: space._id }, { projection: { label: 1 } }),
      client.findAll<{ _id: string; label: string }>(tracker.class.Component, { space: space._id }, { projection: { label: 1 } }),
    ])
    const own = new Set(issues.map((issue) => issue._id))
    const outside = [...new Set(issues.flatMap(linksOf))].filter((id) => !own.has(id))
    const labeled = issues.filter((issue) => (issue.labels ?? 0) > 0).map((issue) => issue._id)
    const [foreign, labels, updates, texts, who] = await Promise.all([
      chunked(outside, (ids) => client.findAll<{ _id: string; identifier: string }>(tracker.class.Issue, { _id: { $in: ids } }, { projection: { identifier: 1 } })),
      chunked(labeled, (ids) => client.findAll<{ attachedTo: string; title: string }>(TAG_REFERENCE, { attachedTo: { $in: ids } }, { projection: { attachedTo: 1, title: 1 } })),
      chunked([...own], (ids) => client.findAll<UpdateDoc>(UPDATE, { attachedTo: { $in: ids } })),
      inParallel(issues, async (issue) => (issue.description ? textOf(await client.fetchMarkup(tracker.class.Issue, issue._id, 'description', issue.description, 'markup')) : { markdown: '', images: [] })),
      authors(issues.map((issue) => issue.createdBy)),
    ])
    const names: Names = {
      status: new Map(statuses.map((doc) => [doc._id, doc.name])),
      milestone: new Map(milestones.map((doc) => [doc._id, doc.label])),
      component: new Map(components.map((doc) => [doc._id, doc.label])),
      issue: new Map([...issues, ...foreign].map((doc) => [doc._id, doc.identifier])),
    }
    const statusById = new Map(statuses.map((doc) => [doc._id, doc]))
    const labelsOf = groupBy(labels, (doc) => doc.attachedTo)
    const updatesOf = groupBy(updates, (doc) => doc.attachedTo)
    const blockedOf = groupBy(issues.flatMap((issue) => (issue.blockedBy ?? []).map((ref) => ({ blocker: ref._id, issue: issue._id }))), (pair) => pair.blocker)
    const link = (id: string): ImportLink[] => {
      const identifier = names.issue.get(id)
      return identifier === undefined ? [] : [{ ref: id, id: identifier, foreign: !own.has(id) }]
    }

    const tasks = issues.map((issue, index): ImportTask => {
      const statusDoc = statusById.get(issue.status)
      if (statusDoc === undefined) throw new Error(`huly: ${issue.identifier} has unknown status ${issue.status}`)
      const status = toStatus(statusDoc)
      const closing = (updatesOf.get(issue._id) ?? []).filter((doc) => isUpdate(doc, issue._id) && doc.attributeUpdates?.attrKey === 'status' && doc.attributeUpdates.set?.[0] === issue.status)
      const parent = issue.attachedTo !== undefined && issue.attachedTo !== NO_PARENT ? link(issue.attachedTo) : []
      return {
        ref: issue._id,
        number: issue.number ?? Number(issue.identifier.slice(issue.identifier.lastIndexOf('-') + 1)),
        id: issue.identifier,
        title: issue.title,
        description: texts[index]!.markdown,
        images: texts[index]!.images.map(imageOf),
        status,
        priority: HULY_PRIORITIES[issue.priority ?? 0] ?? 'none',
        milestone: issue.milestone ? (names.milestone.get(issue.milestone) ?? null) : null,
        component: issue.component ? (names.component.get(issue.component) ?? null) : null,
        labels: (labelsOf.get(issue._id) ?? []).map((doc) => doc.title),
        // Huly keeps hours; the tools speak minutes of the agent's work.
        estimate: issue.estimation ? Math.round(issue.estimation * 60) : null,
        parent: parent[0] ?? null,
        blocks: (blockedOf.get(issue._id) ?? []).flatMap((pair) => link(pair.issue)),
        blockedBy: (issue.blockedBy ?? []).flatMap((ref) => link(ref._id)),
        related: relatedOf(issue).flatMap(link),
        createdAt: issue.createdOn ?? 0,
        createdBy: who(issue.createdBy),
        closedAt: CLOSED.has(status.category) ? (closing.map((doc) => doc.createdOn).sort((a, b) => b - a)[0] ?? null) : null,
      }
    })
    return {
      tasks: tasks.sort((a, b) => a.number - b.number),
      updates: updatesOf,
      images: new Map(issues.map((issue, index) => [issue._id, texts[index]!.images])),
      names,
    }
  }

  async function thread(ref: string): Promise<{ comments: ImportComment[]; images: HulyImage[]; attachments: HulyAttachmentDoc[] }> {
    // No projection: Huly answers a projected query on comments or replies with no documents (BTN-1019).
    const messages = await client.findAll<MessageDoc>(CHAT_MESSAGE, { attachedTo: ref })
    const replies = messages.length === 0 ? [] : await client.findAll<MessageDoc>(THREAD_MESSAGE, { attachedTo: { $in: messages.map((doc) => doc._id) } })
    const all = [...messages, ...replies].sort((a, b) => a.createdOn - b.createdOn)
    const [attachments, who] = await Promise.all([
      client.findAll<HulyAttachmentDoc>(ATTACHMENT, { attachedTo: { $in: [ref, ...all.map((doc) => doc._id)] } }),
      authors(all.map((doc) => doc.createdBy)),
    ])
    const isReply = new Set(replies.map((doc) => doc._id))
    const texts = all.map((doc) => textOf(doc.message))
    const comments = all.map((doc, index): ImportComment => ({
      ref: doc._id,
      author: who(doc.createdBy),
      at: doc.createdOn,
      body: texts[index]!.markdown,
      images: texts[index]!.images.map(imageOf),
      files: attachments.filter((each) => each.attachedTo === doc._id).map((each) => each.file),
      replyTo: isReply.has(doc._id) ? (doc.attachedTo ?? null) : null,
    }))
    return { comments, images: texts.flatMap((each) => each.images), attachments }
  }

  const fileOf = (key: string, name: string, type: string, size: number | null): ImportFile => ({
    key,
    name,
    type,
    size,
    async read() {
      const chunks: Uint8Array[] = []
      for await (const chunk of await deps.readFile(key)) chunks.push(chunk)
      return new Uint8Array(Buffer.concat(chunks))
    },
  })

  return {
    tasks: async () => (await project()).tasks,
    comments: async (ref) => (await thread(ref)).comments,
    async files(ref) {
      const [{ images: own }, { images, attachments }] = await Promise.all([project(), thread(ref)])
      const files = [...attachments]
        .sort((a, b) => (a.createdOn ?? a.modifiedOn) - (b.createdOn ?? b.modifiedOn))
        .map((doc) => fileOf(doc.file, doc.name, doc.type ?? '', doc.size ?? null))
      for (const image of [...(own.get(ref) ?? []), ...images]) {
        if (!files.some((file) => file.key === image.blob)) files.push(fileOf(image.blob, image.name, '', null))
      }
      return files
    },
    async changes(ref) {
      const { updates, names } = await project()
      const docs = (updates.get(ref) ?? []).filter((doc) => isUpdate(doc, ref)).sort((a, b) => a.createdOn - b.createdOn)
      const who = await authors(docs.map((doc) => doc.createdBy))
      return docs.flatMap((doc) => changesOf(doc, names).map((change) => ({ at: doc.createdOn, author: who(doc.createdBy), ...change })))
    },
  }
}

const imageOf = (image: HulyImage) => ({ ref: image.ref, file: image.blob })

function isUpdate(doc: UpdateDoc, issue: string): boolean {
  return doc.action === 'update' && (doc.objectId === undefined || doc.objectId === issue) && doc.attributeUpdates !== undefined
}

function relatedOf(issue: IssueDoc): string[] {
  return (issue.relations ?? []).filter((ref) => ref._class === tracker.class.Issue).map((ref) => ref._id)
}

function linksOf(issue: IssueDoc): string[] {
  const parent = issue.attachedTo !== undefined && issue.attachedTo !== NO_PARENT ? [issue.attachedTo] : []
  return [...parent, ...(issue.blockedBy ?? []).map((ref) => ref._id), ...relatedOf(issue)]
}

type Change = Omit<ImportChange, 'at' | 'author'>

const idOf = (value: unknown): string | null =>
  typeof value === 'string' ? value : value !== null && typeof value === 'object' && typeof (value as { _id?: unknown })._id === 'string' ? (value as { _id: string })._id : null

/** A change of Huly's activity record as the import keeps it; a field Even Keel keeps no history of gives none. */
function changesOf(doc: UpdateDoc, names: Names): Change[] {
  const update = doc.attributeUpdates!
  const named = (map: ReadonlyMap<string, string>) => (value: unknown) => {
    const id = idOf(value)
    return id === null ? null : (map.get(id) ?? null)
  }
  const scalars: Record<string, [Change['field'], (value: unknown) => string | null]> = {
    title: ['title', (value) => (typeof value === 'string' ? value : null)],
    status: ['status', named(names.status)],
    priority: ['priority', (value) => (typeof value === 'number' && value > 0 ? (HULY_PRIORITIES[value] ?? null) : null)],
    milestone: ['milestone', named(names.milestone)],
    component: ['component', named(names.component)],
    estimation: ['estimate', (value) => (typeof value === 'number' && value > 0 ? String(Math.round(value * 60)) : null)],
    attachedTo: ['parent', named(names.issue)],
  }
  const scalar = scalars[update.attrKey]
  if (scalar !== undefined) {
    const [field, value] = scalar
    const from = value(update.prevValue)
    const to = value(update.set?.[0])
    return from === to ? [] : [{ field, from, to }]
  }
  const field: Change['field'] | null = update.attrKey === 'blockedBy' ? 'blockedBy' : update.attrKey === 'relations' ? 'relates' : null
  if (field === null) return []
  const issue = named(names.issue)
  return [
    ...(update.added ?? []).flatMap((value) => (issue(value) === null ? [] : [{ field, from: null, to: issue(value) }])),
    ...(update.removed ?? []).flatMap((value) => (issue(value) === null ? [] : [{ field, from: issue(value), to: null }])),
  ]
}

/**
 * Who a social id is: the person of the account Even Keel signs in with is the agent, the project's creator the user,
 * anyone else a person of the tracker. Names are read once a social id.
 */
function authorsOf(client: HulyImportClient, ownSocialId: string, creator: string | undefined) {
  const people = new Map<string, { person: string; name: string | null }>()
  return async (ids: readonly (string | undefined)[]): Promise<(id: string | undefined) => ImportAuthor | null> => {
    const missing = [...new Set([...ids, ownSocialId, creator])].filter((id): id is string => id !== undefined && !people.has(id))
    if (missing.length > 0) {
      const identities = await chunked(missing, (chunk) => client.findAll<{ _id: string; attachedTo: string }>(SOCIAL_IDENTITY, { _id: { $in: chunk } }, { projection: { attachedTo: 1 } }))
      const persons = await chunked([...new Set(identities.map((doc) => doc.attachedTo))], (chunk) => client.findAll<{ _id: string; name: string }>(PERSON, { _id: { $in: chunk } }, { projection: { name: 1 } }))
      const nameOf = new Map(persons.map((doc) => [doc._id, doc.name ? personName(doc.name) : null]))
      const personOf = new Map(identities.map((doc) => [doc._id, doc.attachedTo]))
      for (const id of missing) {
        const person = personOf.get(id)
        people.set(id, person === undefined ? { person: id, name: null } : { person, name: nameOf.get(person) ?? null })
      }
    }
    const agent = people.get(ownSocialId)!.person
    const user = creator === undefined ? null : people.get(creator)!.person
    return (id) => {
      if (id === undefined) return null
      const { person, name } = people.get(id)!
      return { kind: person === agent ? 'agent' : person === user ? 'user' : 'person', name }
    }
  }
}

async function chunked<T>(ids: readonly string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  for (let start = 0; start < ids.length; start += CHUNK) out.push(...(await read(ids.slice(start, start + CHUNK))))
  return out
}

async function inParallel<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    for (let index = next++; index < items.length; index = next++) out[index] = await work(items[index]!)
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, worker))
  return out
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item])
  return groups
}
