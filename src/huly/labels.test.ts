import { describe, expect, it, vi } from 'vitest'
import { relabelHuly, type HulyLabelClient } from './labels.js'

function fixture() {
  const refs = [{ _id: 'r-bug', space: 'project', title: 'Bug', tag: 'bug', color: 1 }, { _id: 'r-old', space: 'project', title: 'Old', tag: 'old', color: 2 }]
  const tags = [{ _id: 'bug', title: 'Bug', color: 1 }, { _id: 'new', title: 'NEW', color: 3 }]
  const createDoc = vi.fn(async (_cls, _space, attributes) => { tags.push({ _id: 'created', ...attributes }); return 'created' })
  const removeCollection = vi.fn(async (_cls, _space, id) => { refs.splice(refs.findIndex((ref) => ref._id === id), 1) })
  const addCollection = vi.fn(async (_cls, space, _to, _toClass, _collection, attributes) => { refs.push({ _id: 'added-' + refs.length, space, ...attributes }); return 'added' })
  const client: HulyLabelClient = {
    findAll: async <T>(cls: string) => (cls.endsWith('TagElement') ? tags : refs) as T[],
    findOne: async <T>() => ({ _id: 'category' }) as T,
    createDoc, removeCollection, addCollection,
  }
  return { client, refs, createDoc, removeCollection, addCollection }
}

describe('Huly label writes', () => {
  it('uses workspace label definitions, removes references, adds references and returns the saved names', async () => {
    const { client, refs, createDoc, removeCollection, addCollection } = fixture()
    const result = await relabelHuly(client, { _id: 'issue', space: 'project' }, { remove: ['OLD'], add: ['BUG', 'new', 'Other', 'OTHER'] })
    expect(result).toEqual(['Bug', 'NEW', 'Other'])
    expect(createDoc).toHaveBeenCalledExactlyOnceWith('tags:class:TagElement', 'core:space:Workspace', {
      title: 'Other', targetClass: 'tracker:class:Issue', color: 0, description: '', category: 'category',
    })
    expect(removeCollection).toHaveBeenCalledExactlyOnceWith('tags:class:TagReference', 'project', 'r-old', 'issue', 'tracker:class:Issue', 'labels')
    expect(addCollection).toHaveBeenCalledTimes(2)
    expect(refs.map((ref) => ref.tag)).toEqual(['bug', 'new', 'created'])
  })

  it('does not change a label already attached in another case', async () => {
    const { client, createDoc, removeCollection, addCollection } = fixture()
    expect(await relabelHuly(client, { _id: 'issue', space: 'project' }, { add: ['BUG'], remove: [] })).toEqual(['Bug', 'Old'])
    expect(createDoc).not.toHaveBeenCalled()
    expect(removeCollection).not.toHaveBeenCalled()
    expect(addCollection).not.toHaveBeenCalled()
  })

  it('propagates a refusal to create a label before removing existing labels', async () => {
    const { client, createDoc, removeCollection } = fixture()
    createDoc.mockRejectedValue(new Error('permission denied'))
    await expect(relabelHuly(client, { _id: 'issue', space: 'project' }, { add: ['Other'], remove: ['OLD'] })).rejects.toThrow('permission denied')
    expect(removeCollection).not.toHaveBeenCalled()
  })

  it('propagates a refusal to attach a workspace label', async () => {
    const { client, addCollection } = fixture()
    addCollection.mockRejectedValue(new Error('permission denied'))
    await expect(relabelHuly(client, { _id: 'issue', space: 'project' }, { add: ['New'], remove: [] })).rejects.toThrow('permission denied')
  })
})
