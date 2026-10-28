import { changedLabels, labelKey, resolveLabels, type LabelChange } from '../tracker/labels.js'

const ISSUE = 'tracker:class:Issue'
const TAG = 'tags:class:TagElement'
const REFERENCE = 'tags:class:TagReference'

interface Tag { _id: string; title: string; color: number }
interface Reference extends Tag { space: string; tag: string }

export interface HulyLabelClient {
  findAll<T>(cls: string, query: Record<string, unknown>): Promise<T[]>
  findOne<T>(cls: string, query: Record<string, unknown>): Promise<T | undefined>
  createDoc(cls: string, space: string, attributes: Record<string, unknown>): Promise<string>
  removeCollection(cls: string, space: string, id: string, attachedTo: string, attachedToClass: string, collection: string): Promise<unknown>
  addCollection(cls: string, space: string, attachedTo: string, attachedToClass: string, collection: string, attributes: Record<string, unknown>): Promise<string>
}

export async function relabelHuly(client: HulyLabelClient, issue: { _id: string; space: string }, change: LabelChange): Promise<string[]> {
  const query = { attachedTo: issue._id, attachedToClass: ISSUE }
  const refs = await client.findAll<Reference>(REFERENCE, query)
  const tags = await client.findAll<Tag>(TAG, { targetClass: ISSUE })
  const named = (tag: Tag) => ({ ...tag, name: tag.title })
  const selected = await resolveLabels(refs.map((ref) => named({ ...ref, _id: ref.tag })), change, tags.map(named), async (name) => {
    const category = await client.findOne<{ _id: string }>('tags:class:TagCategory', { targetClass: ISSUE, default: true })
    const tag = { title: name, targetClass: ISSUE, color: 0, description: '', category: category?._id ?? 'tracker:category:Other' }
    const id = await client.createDoc(TAG, 'core:space:Workspace', tag)
    return { ...tag, _id: id, name }
  })
  const wanted = new Set(selected.map((label) => labelKey(label.name)))
  const kept = new Set<string>()
  for (const ref of refs) {
    const key = labelKey(ref.title)
    if (wanted.has(key) && !kept.has(key)) kept.add(key)
    else await client.removeCollection(REFERENCE, ref.space, ref._id, issue._id, ISSUE, 'labels')
  }
  for (const label of selected) {
    if (!kept.has(labelKey(label.name))) {
      await client.addCollection(REFERENCE, issue.space, issue._id, ISSUE, 'labels', { tag: label._id, title: label.title, color: label.color })
    }
  }
  return changedLabels((await client.findAll<Reference>(REFERENCE, query)).map((ref) => ref.title), { add: [], remove: [] })
}
