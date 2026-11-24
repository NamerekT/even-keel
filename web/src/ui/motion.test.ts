import { describe, expect, it } from 'vitest'
import type { BlockLamp } from '../state.js'
import { BEAT_MS, STAMP_MS, STEP_MS, motionOf, moveDelay, placeLeaving, stageOf, type Frame } from './motion.js'

interface Item {
  id: string
  lamp: BlockLamp
}

interface Extra {
  hidden?: string[]
  closed?: string[]
  /** The lane tasks; without it — the current one. */
  running?: string[]
  grouped?: string[]
}

const frame = (rows: string, current: string | null = null, extra: Extra = {}): Frame<Item> => {
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
    running: new Set(extra.running ?? (current === null ? [] : [current])),
    grouped: new Set(extra.grouped ?? []),
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
    expect(motion.quiet).toEqual({ entered: 4, archived: 6, removed: 0, moved: null })
    expect(motion.entered).toEqual(['H', 'I', 'J', 'K'])
    expect(motion.leaving).toEqual([])
    expect(motion.taken).toBeNull()
    expect(motion.finished).toEqual([])
    expect(motion.delays).toEqual({})
  })

  it('counts every task in the summary, the ones out of sight too, but marks only those in sight', () => {
    const before = frame('A B')
    const after = frame('A B C D E F G H I J', null, { hidden: ['I', 'J'] })
    const motion = motionOf(before, after, none)!
    expect(motion.quiet).toEqual({ entered: 8, archived: 0, removed: 0, moved: null })
    expect(motion.entered).toEqual(['C', 'D', 'E', 'F', 'G', 'H'])
  })

  it('tells of a tracker switch instead of counting the renamed tasks as gone and new', () => {
    const before = frame('MVT-1:working MVT-2 MVT-3 MVT-4 MVT-5', 'MVT-1')
    const after = frame('MVU-68:working MVU-69 MVU-70 MVU-71 MVU-72 MVU-73 MVU-74', 'MVU-68', { hidden: ['MVU-74'] })
    const motion = motionOf(before, after, none)!
    expect(motion.quiet).toEqual({ entered: 0, archived: 0, removed: 0, moved: { from: ['MVT'], to: ['MVU'] } })
    expect(motion.entered).toEqual([])
    expect(motion.leaving).toEqual([])
    expect(motion.taken).toBeNull()
  })

  it('tells of a switch even when only a few tasks were renamed', () => {
    const motion = motionOf(frame('MVT-1 MVT-2'), frame('MVU-7 MVU-8'), none)!
    expect(motion.quiet).toEqual({ entered: 0, archived: 0, removed: 0, moved: { from: ['MVT'], to: ['MVU'] } })
  })

  it('still counts the tasks of a feed that kept its keys through the switch', () => {
    const motion = motionOf(frame('MVT-1 GH-1 GH-2'), frame('MVU-7 GH-1 GH-3', null, { closed: ['GH-2'] }), none)!
    expect(motion.quiet).toEqual({ entered: 1, archived: 1, removed: 0, moved: { from: ['MVT'], to: ['MVU'] } })
    expect(motion.entered).toEqual(['GH-3'])
  })
})

describe('motionOf: the running group (BTN-1613)', () => {
  it('lets a task another machine took join the running one, without drawing a frame of its own', () => {
    const before = frame('A:working B C D', 'A')
    const after = frame('A:working D:working B C', 'A', { running: ['A', 'D'], grouped: ['A', 'D'] })
    const motion = motionOf(before, after, none)!
    expect(motion.joined).toEqual(['D'])
    expect(motion.merged).toEqual(['A'])
    expect(motion.taken).toBeNull()
    expect(motion.delays).toEqual({ take: 0 })
    expect(moveDelay(motion, 'D')).toBe(0)
    expect(moveDelay(motion, 'B')).toBe(0)
  })

  it('lets a task out after its lane let it go: its own frame first, then the move, the last one getting its frame back', () => {
    const before = frame('A:working D:working B C', 'A', { running: ['A', 'D'], grouped: ['A', 'D'] })
    const after = frame('A:working B C D:stopped', 'A')
    const motion = motionOf(before, after, none)!
    expect(motion.parted).toEqual(['D'])
    expect(motion.alone).toEqual(['A'])
    expect(motion.delays).toEqual({ part: 0 })
    expect(moveDelay(motion, 'D')).toBe(STEP_MS)
    expect(moveDelay(motion, 'B')).toBe(STEP_MS)
    const marks = stageOf([motion]).marks
    expect(marks.get('D')).toEqual(new Map([['part', 0]]))
    expect(marks.get('A')).toEqual(new Map([['solo', STEP_MS]]))
  })

  it('lets a done task out after its stamp, and the other lane task that leads now is no new take', () => {
    const before = frame('Z:done A:working D:working B', 'A', { running: ['A', 'D'], grouped: ['A', 'D'] })
    const after = frame('A:done D:working B', 'D', { closed: ['Z'] })
    const motion = motionOf(before, after, none)!
    expect(motion.finished).toEqual(['A'])
    expect(motion.parted).toEqual(['A'])
    expect(motion.taken).toBeNull()
    expect(motion.delays).toEqual({ finish: 0, part: STAMP_MS, leave: STAMP_MS + BEAT_MS })
    expect(moveDelay(motion, 'A')).toBe(STAMP_MS + STEP_MS)
  })

  it('keeps the groups out of a lone take', () => {
    const motion = motionOf(frame('A:done B C', null), frame('A:done B:working C', 'B'), none)!
    expect(motion.taken).toBe('B')
    expect([motion.joined, motion.merged, motion.parted, motion.alone]).toEqual([[], [], [], []])
  })
})

describe('motionOf: a fix of main in the running group (BTN-1617)', () => {
  const group = frame('Z:done A:working D:working B', 'A', { running: ['A', 'D'], grouped: ['A', 'D'] })
  const fixing = frame('Z:done F:working D:working A:stopped B', 'F', { running: ['F', 'D'], grouped: ['F', 'D'] })

  it('lets the task a red main stopped out of the group and the fix in', () => {
    const motion = motionOf(group, fixing, none)!
    expect(motion.parted).toEqual(['A'])
    expect(motion.entered).toEqual(['F'])
    expect(motion.joined).toEqual(['F'])
    expect(motion.taken).toBeNull()
    expect(motion.delays).toEqual({ part: 0, enter: BEAT_MS, take: 2 * BEAT_MS })
    expect(moveDelay(motion, 'A')).toBe(STEP_MS)
  })

  it('lets the fix that landed out and the interrupted task back in', () => {
    const landed = frame('Z:done F:fixed A:working D:working B', 'A', { running: ['A', 'D'], grouped: ['A', 'D'], closed: ['F'] })
    const motion = motionOf(fixing, landed, none)!
    expect(motion.parted).toEqual(['F'])
    expect(motion.joined).toEqual(['A'])
    expect([motion.merged, motion.alone, motion.taken]).toEqual([[], [], null])
  })

  const red = frame('Z:done F:fixed D:working A:stopped B', 'A', { running: ['D'], closed: ['F'] })

  it('leaves the task a red after the fix gave back out of the group, the other lane alone', () => {
    const motion = motionOf(fixing, red, none)!
    expect(motion.parted).toEqual(['F'])
    expect(motion.alone).toEqual(['D'])
    expect(motion.joined).toEqual([])
    // The paused chain's current task gets its own frame drawn, as on one machine.
    expect(motion.taken).toBe('A')
  })

  it('lets the task a red after the fix gave back join the group once its lane runs it again', () => {
    const resumed = frame('Z:done F:fixed A:working D:working B', 'A', { running: ['A', 'D'], grouped: ['A', 'D'], closed: ['F'] })
    const motion = motionOf(red, resumed, none)!
    expect(motion.joined).toEqual(['A'])
    expect(motion.merged).toEqual(['D'])
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

  it('anchors an older leaving copy to a newer one when its anchor left too', () => {
    const placed = placeLeaving([[block('B')]], [
      { item: block('A'), after: null, archived: true },
      { item: block('X'), after: 'A', archived: false },
    ])
    expect(placed[0]!.map((slot) => `${slot.block.id}${slot.leaving ? '-' : ''}`)).toEqual(['A-', 'X-', 'B'])
  })

  it('drops a copy of a task that is back in the chain, a repeated one and one whose anchor is gone', () => {
    const placed = placeLeaving([[block('A'), block('B')]], [
      { item: block('B'), after: 'A', archived: false },
      { item: block('C'), after: 'A', archived: false },
      { item: block('C'), after: 'B', archived: false },
      { item: block('D'), after: 'Q', archived: false },
    ])
    expect(placed[0]!.map((slot) => `${slot.block.id}${slot.leaving ? '-' : ''}`)).toEqual(['A', 'C-', 'B'])
  })
})

describe('stageOf', () => {
  const play = (rows: string, current: string | null, next: string, nextCurrent: string | null = null, closed: string[] = []) =>
    motionOf(frame(rows, current), frame(next, nextCurrent, { closed }), none)!

  it('keeps every running motion: a later change adds to the marks and the leaving copies, it does not cut them', () => {
    const first = play('A:done B:working C', 'B', 'B:done C', null, ['A'])
    const second = play('B:done C', null, 'B:done C:working X', 'C')
    const stage = stageOf([first, second])
    expect(stage.leaving.map((each) => [each.item.id, each.beat])).toEqual([['A', BEAT_MS]])
    expect(stage.marks.get('B')).toEqual(new Map([['finish', 0]]))
    expect(stage.marks.get('C')).toEqual(new Map([['take', BEAT_MS]]))
    expect(stage.marks.get('X')).toEqual(new Map([['enter', 0]]))
    expect(stage.bump).toBe(BEAT_MS)
  })

  it('lists the leaving copies of the newest motion first, so the older ones can anchor to them', () => {
    const first = play('A B C', null, 'A C')
    const second = play('A C', null, 'C')
    expect(stageOf([first, second]).leaving.map((each) => each.item.id)).toEqual(['A', 'B'])
  })

  it('lets a block carry marks of different motions at once, the newer one winning a mark of the same kind', () => {
    const first = play('A B', null, 'A B', 'A')
    const second = play('A B', 'A', 'A:done B', 'B')
    const third = play('A:done B', 'B', 'A:done B X', 'A')
    const stage = stageOf([first, second, third])
    expect(stage.marks.get('A')).toEqual(new Map([['take', BEAT_MS], ['finish', 0]]))
  })

  it('shows the summary of the newest quiet motion and marks its new tasks as fresh', () => {
    const quiet = motionOf(frame('A:done B C D E F G', 'B'), frame('G:done H I J K', 'H', { closed: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] }), none)!
    const stage = stageOf([quiet])
    expect(stage.quiet).toEqual({ entered: 4, archived: 6, removed: 0, moved: null })
    expect(stage.marks.get('H')).toEqual(new Map([['fresh', 0]]))
    expect(stage.bump).toBeNull()
  })

  it('is empty without motions', () => {
    const stage = stageOf([])
    expect(stage.leaving).toEqual([])
    expect(stage.marks.size).toBe(0)
    expect(stage.quiet).toBeNull()
    expect(stage.bump).toBeNull()
  })
})
