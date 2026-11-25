import { describe, expect, it } from 'vitest'
import { modifiedOf, settleTexts, withServiceOf, type MergeTexts } from './merge.js'

const record = (body: string, service: { session?: string; modified?: string } = {}) =>
  [
    '---',
    'name: tone',
    'description: Short answers',
    'metadata:',
    '  node_type: memory',
    '  type: feedback',
    ...(service.session === undefined ? [] : [`  originSessionId: ${service.session}`]),
    ...(service.modified === undefined ? [] : [`  modified: ${service.modified}`]),
    '---',
    '',
    body,
    '',
  ].join('\n')

const never: MergeTexts = async () => {
  throw new Error('no merge expected')
}

describe('withServiceOf', () => {
  it('takes the other text\'s service lines and drops the ones it lacks', () => {
    const own = record('Body.', { session: 'aaa', modified: '2026-11-24T10:00:00.000Z' })
    const other = record('Other.', { modified: '2026-11-24T12:00:00.000Z' })
    expect(withServiceOf(own, other)).toBe(record('Body.', { modified: '2026-11-24T12:00:00.000Z' }))
  })

  it('leaves a text without frontmatter and the body\'s look-alike lines alone', () => {
    expect(withServiceOf('modified: x\n', record('Body.'))).toBe('modified: x\n')
    const own = record('modified: in the body', { modified: '2026-11-24T10:00:00.000Z' })
    expect(withServiceOf(own, record('Other.'))).toBe(record('modified: in the body'))
  })
})

describe('modifiedOf', () => {
  it('reads the frontmatter\'s modified, quoted or not', () => {
    expect(modifiedOf(record('Body.', { modified: '2026-11-24T10:00:00.000Z' }))).toBe(Date.parse('2026-11-24T10:00:00.000Z'))
    expect(modifiedOf(record('Body.', { modified: '"2026-11-24T10:00:00.000Z"' }))).toBe(Date.parse('2026-11-24T10:00:00.000Z'))
    expect(modifiedOf(record('Body.'))).toBeNull()
    expect(modifiedOf(record('Body.', { modified: 'soon' }))).toBeNull()
  })
})

describe('settleTexts', () => {
  const early = '2026-11-24T18:31:00.000Z'
  const late = '2026-11-24T20:46:00.000Z'

  it('takes two versions that differ only in the service fields as one, the newer one', async () => {
    const own = record('Body.', { session: 'aaa', modified: early })
    const remote = record('Body.', { session: 'bbb', modified: late })
    expect(await settleTexts({ base: null, own, remote, ownCommitted: 0, remoteCommitted: 0 }, never)).toEqual({ text: remote, kind: 'same', newer: 'remote' })
    expect(await settleTexts({ base: record('Old.'), own, remote, ownCommitted: 0, remoteCommitted: 0 }, never)).toMatchObject({ kind: 'same' })
  })

  it('keeps the newer of two different versions that have no common one, by modified, else by commit', async () => {
    const own = record('Own.', { modified: late })
    const remote = record('Remote.', { modified: early })
    expect(await settleTexts({ base: null, own, remote, ownCommitted: 1, remoteCommitted: 2 }, never)).toEqual({ text: own, kind: 'newer', newer: 'own' })
    expect(await settleTexts({ base: null, own: record('Own.'), remote: record('Remote.'), ownCommitted: 1, remoteCommitted: 2 }, never)).toMatchObject({ newer: 'remote', kind: 'newer' })
    expect(await settleTexts({ base: null, own: record('Own.'), remote: record('Remote.'), ownCommitted: 2, remoteCommitted: 2 }, never)).toMatchObject({ newer: 'own' })
  })

  it('merges three texts whose service fields are made the newer side\'s first', async () => {
    const base = record('Body.', { session: 'base', modified: early })
    const own = record('Body.\n\nOwn paragraph.', { session: 'aaa', modified: early })
    const remote = record('Body.', { session: 'bbb', modified: late })
    const seen: string[][] = []
    const merge: MergeTexts = async (...texts) => {
      seen.push(texts)
      return 'merged'
    }
    expect(await settleTexts({ base, own, remote, ownCommitted: 0, remoteCommitted: 0 }, merge)).toEqual({ text: 'merged', kind: 'merged', newer: 'remote' })
    expect(seen).toEqual([[record('Body.', { session: 'bbb', modified: late }), record('Body.\n\nOwn paragraph.', { session: 'bbb', modified: late }), remote]])
  })

  it('keeps the newer version of a real conflict', async () => {
    const own = record('Own.', { modified: early })
    const remote = record('Remote.', { modified: late })
    expect(await settleTexts({ base: record('Base.'), own, remote, ownCommitted: 0, remoteCommitted: 0 }, async () => null)).toEqual({ text: remote, kind: 'conflict', newer: 'remote' })
  })
})
