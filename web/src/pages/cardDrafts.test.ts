import { describe, expect, it } from 'vitest'
import { dropDraft, fitsKeepalive, KEEPALIVE_BYTES, leftoverOf, readDraft, writeDraft, type DraftStore } from './cardDrafts.js'

function memoryStore(): DraftStore & { items: Map<string, string> } {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  }
}

describe('a card field draft kept in the browser', () => {
  it('is read back as written, field by field', () => {
    const store = memoryStore()
    writeDraft('p1', 'ABC-1', 'title', { from: 'Old', to: 'New' }, store)
    expect(readDraft('p1', 'ABC-1', 'title', store)).toEqual({ from: 'Old', to: 'New' })
    expect(readDraft('p1', 'ABC-1', 'description', store)).toBeNull()
  })

  it('keeps tasks of two projects with the same key apart', () => {
    const store = memoryStore()
    writeDraft('p1', 'ABC-1', 'note', { from: '', to: 'first' }, store)
    writeDraft('p2', 'ABC-1', 'note', { from: '', to: 'second' }, store)
    expect(readDraft('p1', 'ABC-1', 'note', store)?.to).toBe('first')
    expect(readDraft('p2', 'ABC-1', 'note', store)?.to).toBe('second')
  })

  it('is gone once dropped', () => {
    const store = memoryStore()
    writeDraft('p1', 'ABC-1', 'title', { from: 'Old', to: 'New' }, store)
    dropDraft('p1', 'ABC-1', 'title', store)
    expect(readDraft('p1', 'ABC-1', 'title', store)).toBeNull()
    expect(store.items.size).toBe(0)
  })

  it('reads a damaged entry as none', () => {
    const store = memoryStore()
    writeDraft('p1', 'ABC-1', 'title', { from: 'Old', to: 'New' }, store)
    store.items.set([...store.items.keys()][0]!, '{"from":1}')
    expect(readDraft('p1', 'ABC-1', 'title', store)).toBeNull()
  })

  it('does nothing in a browser that keeps no storage', () => {
    const refusing: DraftStore = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    }
    expect(() => writeDraft('p1', 'ABC-1', 'title', { from: 'a', to: 'b' }, refusing)).not.toThrow()
    expect(readDraft('p1', 'ABC-1', 'title', refusing)).toBeNull()
    expect(() => dropDraft('p1', 'ABC-1', 'title', refusing)).not.toThrow()
    expect(readDraft('p1', 'ABC-1', 'title', null)).toBeNull()
  })
})

describe('a draft left over from a closed card', () => {
  it('is none when the field already holds it: the edit landed', () => {
    expect(leftoverOf({ from: 'Old', to: 'New' }, 'New')).toBeNull()
  })

  it('is to be sent again when the field holds anything else', () => {
    expect(leftoverOf({ from: 'Old', to: 'New' }, 'Old')).toEqual({ from: 'Old', to: 'New' })
    expect(leftoverOf({ from: 'Old', to: 'New' }, 'Theirs')).toEqual({ from: 'Old', to: 'New' })
  })

  it('is none when there is no draft', () => {
    expect(leftoverOf(null, 'Old')).toBeNull()
  })
})

describe('a body the browser carries past the closed tab', () => {
  it('fits up to the limit, counted in bytes', () => {
    expect(fitsKeepalive('a'.repeat(KEEPALIVE_BYTES))).toBe(true)
    expect(fitsKeepalive('a'.repeat(KEEPALIVE_BYTES + 1))).toBe(false)
    expect(fitsKeepalive('я'.repeat(KEEPALIVE_BYTES / 2 + 1))).toBe(false)
  })
})
