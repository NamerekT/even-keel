import { describe, expect, it } from 'vitest'
import type { ChainBlock } from '../state.js'
import { CHAIN_MORE, CHAIN_PAGE, droppedOrder, milestonePage, staysInView } from './chainPage.js'

interface Row {
  id: string
  keep?: boolean
  ghost?: boolean
}

const rows = (count: number, from = 1): Row[] => Array.from({ length: count }, (_, index) => ({ id: `T-${from + index}` }))
const ids = (list: Row[]) => list.map((row) => row.id)
const keeps = (row: Row) => row.keep === true
const counts = (row: Row) => row.ghost !== true

describe('milestonePage', () => {
  it('shows a short milestone whole, with no button', () => {
    const page = milestonePage(rows(CHAIN_PAGE), 0, { keeps })
    expect(page.head).toHaveLength(CHAIN_PAGE)
    expect([page.kept, page.hidden, page.next]).toEqual([[], 0, 0])
  })

  it('cuts a long milestone at the page and adds a step a press', () => {
    const blocks = rows(CHAIN_PAGE + 40)
    const first = milestonePage(blocks, 0, { keeps })
    expect(ids(first.head)).toEqual(ids(blocks.slice(0, CHAIN_PAGE)))
    expect([first.hidden, first.next]).toEqual([40, CHAIN_MORE])
    const second = milestonePage(blocks, 1, { keeps })
    expect(second.head).toHaveLength(CHAIN_PAGE + CHAIN_MORE)
    expect([second.hidden, second.next]).toEqual([40 - CHAIN_MORE, CHAIN_MORE])
    const last = milestonePage(blocks, 2, { keeps })
    expect([last.hidden, last.next]).toEqual([40 - 2 * CHAIN_MORE, 40 - 2 * CHAIN_MORE])
    expect(milestonePage(blocks, 3, { keeps }).hidden).toBe(0)
  })

  it('keeps a row that must stay in view past the cut, under the button, out of the hidden count', () => {
    const blocks = rows(CHAIN_PAGE + 30)
    blocks[CHAIN_PAGE + 10] = { id: 'LIVE-1', keep: true }
    const page = milestonePage(blocks, 0, { keeps })
    expect(ids(page.kept)).toEqual(['LIVE-1'])
    expect(page.hidden).toBe(29)
    expect(page.head).toHaveLength(CHAIN_PAGE)
  })

  it('takes a kept row into the head once a press reaches it', () => {
    const blocks = rows(CHAIN_PAGE + 30)
    blocks[CHAIN_PAGE + 3] = { id: 'LIVE-1', keep: true }
    const page = milestonePage(blocks, 1, { keeps })
    expect(page.kept).toEqual([])
    expect(page.head.map((row) => row.id)).toContain('LIVE-1')
  })

  it('puts kept rows back in the head when nothing else is behind the button', () => {
    const blocks = [...rows(CHAIN_PAGE), { id: 'LIVE-1', keep: true }]
    const page = milestonePage(blocks, 0, { keeps })
    expect(ids(page.head)).toEqual(ids(blocks))
    expect([page.kept, page.hidden]).toEqual([[], 0])
  })

  it('opens as many steps as the focused row needs', () => {
    const blocks = rows(CHAIN_PAGE + 40)
    const page = milestonePage(blocks, 0, { keeps, focus: `T-${CHAIN_PAGE + 20}` })
    expect(page.head).toHaveLength(CHAIN_PAGE + 2 * CHAIN_MORE)
    expect(milestonePage(blocks, 0, { keeps, focus: `T-${CHAIN_PAGE + 1}` }).head).toHaveLength(CHAIN_PAGE + CHAIN_MORE)
  })

  it('does not count an uncounted row toward the page and hides it past the cut', () => {
    const inside = rows(CHAIN_PAGE + 5).toSpliced(10, 0, { id: 'GHOST', ghost: true })
    const page = milestonePage(inside, 0, { keeps, counts })
    expect(page.head).toHaveLength(CHAIN_PAGE + 1)
    expect(page.hidden).toBe(5)
    const past = rows(CHAIN_PAGE + 5).toSpliced(CHAIN_PAGE + 2, 0, { id: 'GHOST', ghost: true })
    const hidden = milestonePage(past, 0, { keeps, counts })
    expect(ids(hidden.head)).not.toContain('GHOST')
    expect(hidden.hidden).toBe(5)
  })
})

describe('staysInView', () => {
  const plain = { current: false, question: false, lamp: 'ahead' as const, session: null }
  const session = (lamp: 'working' | 'finished') => ({ lamp }) as NonNullable<ChainBlock['session']>

  it('keeps the current task, a question, an error and a live session', () => {
    expect(staysInView(plain)).toBe(false)
    expect(staysInView({ ...plain, current: true })).toBe(true)
    expect(staysInView({ ...plain, question: true })).toBe(true)
    expect(staysInView({ ...plain, lamp: 'error' })).toBe(true)
    expect(staysInView({ ...plain, session: session('working') })).toBe(true)
    expect(staysInView({ ...plain, session: session('finished') })).toBe(false)
  })
})

describe('droppedOrder', () => {
  const moveItem = (list: string[], from: number, to: number) => {
    const next = list.toSpliced(from, 1)
    next.splice(to, 0, list[from]!)
    return next
  }

  it('equals the dropped order followed by the rest when only a tail is out of view', () => {
    const visible = ['A', 'B', 'C', 'D']
    const tail = ['E', 'F']
    const dropped = moveItem(visible, 0, 3)
    expect(droppedOrder([...visible, ...tail], dropped, 'A')).toEqual([...dropped, ...tail])
  })

  it('puts a task dropped under the last visible row right after it, ahead of the hidden ones', () => {
    const full = ['A', 'B', 'C', 'h1', 'h2', 'K', 'h3', 'N']
    const dropped = ['B', 'C', 'A', 'K', 'N']
    expect(droppedOrder(full, dropped, 'A')).toEqual(['B', 'C', 'A', 'h1', 'h2', 'K', 'h3', 'N'])
  })

  it('puts a task dropped under a kept row right after that row', () => {
    const full = ['A', 'B', 'C', 'h1', 'K', 'h2', 'N']
    expect(droppedOrder(full, ['B', 'C', 'K', 'A', 'N'], 'A')).toEqual(['B', 'C', 'h1', 'K', 'A', 'h2', 'N'])
  })

  it('puts a task dropped on top before the first visible row', () => {
    const full = ['A', 'B', 'h1', 'C']
    expect(droppedOrder(full, ['C', 'A', 'B'], 'C')).toEqual(['C', 'A', 'B', 'h1'])
  })

  it('leaves the order as it was when the moved task is not in it', () => {
    expect(droppedOrder(['A', 'B'], ['A', 'B'], 'Z')).toEqual(['A', 'B'])
  })
})
