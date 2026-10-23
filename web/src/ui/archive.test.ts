import { describe, expect, it } from 'vitest'
import type { BlockLamp } from '../state.js'
import { archiveView } from './archive.js'

const chain = (closed: number, open: number) => [
  ...Array.from({ length: closed }, (_, index) => ({
    id: `T-${index + 1}`,
    lamp: 'done' as BlockLamp,
  })),
  ...Array.from({ length: open }, (_, index) => ({
    id: `T-${closed + index + 1}`,
    lamp: 'ahead' as BlockLamp,
  })),
]

const ids = (blocks: { id: string }[]) => blocks.map((block) => block.id)

describe('archiveView', () => {
  it('archives a fix of main that is over like a closed task, and counts the fixes apart', () => {
    const blocks = chain(4, 1).toSpliced(2, 0, { id: 'T-FIX.1', lamp: 'fixed' })
    const view = archiveView(blocks, 1, '')
    expect(ids(view.archived)).toEqual(['T-1', 'T-2', 'T-FIX.1', 'T-3'])
    expect(ids(view.visible)).toEqual(['T-4', 'T-5'])
    expect([view.shown, view.shownFixes]).toEqual([4, 1])
    const folded = archiveView(blocks, 0, '')
    expect([folded.hidden, folded.hiddenFixes, folded.shownFixes]).toEqual([4, 1, 0])
  })

  it('keeps only the last closed block in front of the open ones', () => {
    const view = archiveView(chain(40, 2), 0, '')
    expect(ids(view.visible)).toEqual(['T-40', 'T-41', 'T-42'])
    expect(view.archived).toEqual([])
    expect(view.shown).toBe(0)
    expect(view.hidden).toBe(39)
    expect(view.next).toBe(16)
  })

  it('reveals sixteen more closed blocks per page, apart from the chain', () => {
    const view = archiveView(chain(40, 1), 1, '')
    expect(ids(view.archived)[0]).toBe('T-24')
    expect(view.archived).toHaveLength(16)
    expect(ids(view.visible)).toEqual(['T-40', 'T-41'])
    expect(view.hidden).toBe(23)
    expect(view.next).toBe(16)
  })

  it('offers only what is left on the last page', () => {
    const view = archiveView(chain(40, 1), 2, '')
    expect(view.hidden).toBe(7)
    expect(view.next).toBe(7)
    const all = archiveView(chain(40, 1), 3, '')
    expect(all.archived).toHaveLength(39)
    expect(all.visible).toHaveLength(2)
    expect(all.hidden).toBe(0)
    expect(all.next).toBe(0)
  })

  it('treats canceled blocks as closed', () => {
    const blocks = [
      { id: 'T-1', lamp: 'canceled' as BlockLamp },
      { id: 'T-2', lamp: 'done' as BlockLamp },
      { id: 'T-3', lamp: 'working' as BlockLamp },
    ]
    expect(ids(archiveView(blocks, 0, '').visible)).toEqual(['T-2', 'T-3'])
  })

  it('keeps in view a closed task whose cleanup left work in its folder, and does not count it as archived', () => {
    const work = { path: 'D:/work/t-3', branch: 't-3/task', files: 2, ahead: 0 }
    const blocks = chain(20, 1).map((block) => (block.id === 'T-3' ? { ...block, work } : block))
    const view = archiveView(blocks, 0, '')
    expect(ids(view.visible)).toEqual(['T-3', 'T-20', 'T-21'])
    expect([view.shown, view.hidden]).toEqual([0, 18])
    const opened = archiveView(blocks, 1, '')
    expect(ids(opened.visible)).toEqual(['T-3', 'T-20', 'T-21'])
    expect(ids(opened.archived)).toEqual(ids(chain(19, 0).slice(3)))
    expect([opened.shown, opened.hidden]).toEqual([16, 2])
  })

  it('hides nothing when at most one block is closed', () => {
    expect(archiveView(chain(1, 3), 0, '').hidden).toBe(0)
    expect(archiveView(chain(0, 3), 0, '').visible).toHaveLength(3)
    expect(archiveView([], 0, '').visible).toEqual([])
  })

  it('opens enough pages to show a focused archived block', () => {
    const view = archiveView(chain(40, 1), 0, 'T-10')
    expect(ids(view.archived)).toContain('T-10')
    expect(view.shown).toBe(32)
    expect(view.hidden).toBe(7)
    expect(view.next).toBe(7)
  })

  it('ignores a focus that is not archived', () => {
    expect(archiveView(chain(40, 1), 0, 'T-41').hidden).toBe(39)
    expect(archiveView(chain(40, 1), 0, 'T-99').hidden).toBe(39)
  })
})
