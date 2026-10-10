import { describe, expect, it } from 'vitest'
import type { BlockLamp } from '../state.js'
import { BEAT_MS, motionOf, placeLeaving, type Frame } from './motion.js'

interface Item {
  id: string
  lamp: BlockLamp
}

const frame = (rows: string, current: string | null = null, extra: { hidden?: string[]; closed?: string[] } = {}): Frame<Item> => {
  const items = rows
    .split(' ')
    .filter((row) => row !== '')
    .map((row) => {
      const [id, lamp = 'ahead'] = row.split(':')
      return { id: id!, lamp: lamp as BlockLamp }
    })
  const order = items.map((item) => item.id)
  const hidden = new Set(extra.hidden ?? [])
  const closed = items.filter((item) => item.lamp === 'done' || item.lamp === 'canceled').map((item) => item.id)
  return {
    order,
    items: new Map(items.map((item) => [item.id, item])),
    shown: new Set(order.filter((id) => !hidden.has(id))),
    closed: new Set([...closed, ...(extra.closed ?? [])]),
    current,
  }
}

const none = new Set<string>()

describe('motionOf', () => {
  it('finds nothing when the chain did not change', () => {
    expect(motionOf(frame('A:done B:working C'), frame('A:done B:working C'), none)).toBeNull()
  })

  it('marks a task new to the chain as entered', () => {
    const motion = motionOf(frame('A B'), frame('A X B'), none)!
    expect(motion.entered).toEqual(['X'])
    expect(motion.leaving).toEqual([])
    expect(motion.delays).toEqual({ enter: 0 })
  })

  it('does not mark a task that enters a folded milestone or arrives from the backlog', () => {
    expect(motionOf(frame('A B'), frame('A B X', null, { hidden: ['X'] }), none)).toBeNull()
    expect(motionOf(frame('A B'), frame('A B X'), new Set(['X']))).toBeNull()
  })

  it('keeps a task that left the chain in sight next to the task it followed', () => {
    const motion = motionOf(frame('A:done B C D'), frame('B:done D', null, { closed: ['A'] }), none)!
    expect(motion.leaving).toEqual([
      { item: { id: 'A', lamp: 'done' }, after: null, archived: true },
      { item: { id: 'C', lamp: 'ahead' }, after: 'B', archived: false },
    ])
  })

  it('anchors a leaving task to the nearest earlier task still in sight', () => {
    const motion = motionOf(frame('A B C D'), frame('A B D', null, { hidden: ['B'] }), none)!
    expect(motion.leaving[0]!.after).toBe('A')
  })

  it('does not bring back a task that was folded away when it left', () => {
    expect(motionOf(frame('A B C', null, { hidden: ['C'] }), frame('A B'), none)).toBeNull()
  })

  it('does not double a task that went to an archive page the user has unfolded', () => {
    const after = { ...frame('B C'), shown: new Set(['A', 'B', 'C']) }
    expect(motionOf(frame('A:done B C'), after, none)).toBeNull()
  })

  it('plays a handover as finish, archive, take in turn', () => {
    const before = frame('A:done B:working C', 'B')
    const after = frame('B:done C:working', 'C', { closed: ['A'] })
    const motion = motionOf(before, after, none)!
    expect(motion.finished).toEqual(['B'])
    expect(motion.taken).toBe('C')
    expect(motion.leaving.map((each) => each.item.id)).toEqual(['A'])
    expect(motion.delays).toEqual({ finish: 0, leave: BEAT_MS, take: 2 * BEAT_MS })
  })

  it('shows the net change only: a task that came and went while unseen is not there', () => {
    expect(motionOf(frame('A:done B', 'B'), frame('A:done B', 'B'), none)).toBeNull()
  })

  it('sums up instead of playing when too much changed', () => {
    const before = frame('A:done B C D E F G', 'B')
    const after = frame('G:done H I J K', 'H', { closed: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] })
    const motion = motionOf(before, after, none)!
    expect(motion.quiet).toEqual({ entered: 4, archived: 6, removed: 0 })
    expect(motion.entered).toEqual(['H', 'I', 'J', 'K'])
    expect(motion.leaving).toEqual([])
    expect(motion.taken).toBeNull()
    expect(motion.finished).toEqual([])
    expect(motion.delays).toEqual({})
  })
})

describe('placeLeaving', () => {
  const block = (id: string) => ({ id, lamp: 'ahead' as BlockLamp })

  it('puts each leaving task after its anchor, the anchorless ones at the top', () => {
    const sections = [[block('A'), block('B')], [block('D')]]
    const placed = placeLeaving(sections, [
      { item: block('Z'), after: null, archived: true },
      { item: block('C'), after: 'B', archived: false },
    ])
    expect(placed.map((section) => section.map((slot) => `${slot.block.id}${slot.leaving ? '-' : ''}`))).toEqual([
      ['Z-', 'A', 'B', 'C-'],
      ['D'],
    ])
  })

  it('keeps the order of several tasks leaving after one anchor', () => {
    const placed = placeLeaving([[block('A')]], [
      { item: block('B'), after: 'A', archived: false },
      { item: block('C'), after: 'A', archived: false },
    ])
    expect(placed[0]!.map((slot) => slot.block.id)).toEqual(['A', 'B', 'C'])
  })
})
