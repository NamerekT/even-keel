import { describe, expect, it } from 'vitest'
import type { Feed } from '../config.js'
import { changedMoves } from './move-check.js'

const feed = (moves?: Feed['moves']): Feed => ({ id: 'f1', tracker: 'huly', key: 'OPS', ...(moves === undefined ? {} : { moves }) })

describe('changedMoves', () => {
  it('names the main trackers and feeds whose status moves are set anew', () => {
    const before = { moves: { a: { start: 'In Progress' } }, feeds: { a: [feed()] } }
    const after = { moves: { a: { start: 'In Progress' }, b: { review: 'In Review' } }, feeds: { a: [feed({ done: 'Done' })] } }
    expect(changedMoves(before, after)).toEqual([
      { project: 'b', feed: undefined, moves: { review: 'In Review' } },
      { project: 'a', feed: feed({ done: 'Done' }), moves: { done: 'Done' } },
    ])
  })

  it('leaves out sources whose moves stayed or were dropped', () => {
    const before = { moves: { a: { start: 'In Progress' } }, feeds: { a: [feed({ done: 'Done' })] } }
    expect(changedMoves(before, { moves: { a: { start: 'In Progress' } }, feeds: { a: [feed({ done: 'Done' })] } })).toEqual([])
    expect(changedMoves(before, { moves: {}, feeds: { a: [feed()] } })).toEqual([])
  })
})
