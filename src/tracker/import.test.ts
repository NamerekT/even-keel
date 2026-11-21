import { describe, expect, it } from 'vitest'
import { withBefore, type ImportChange } from './import.js'

const change = (at: number, field: ImportChange['field'], from: string | null, to: string | null): ImportChange => ({ at, author: null, field, from, to })

describe('withBefore', () => {
  it("takes a change's missing before from the field's change before it", () => {
    const out = withBefore([
      change(10, 'status', null, 'In Progress'),
      change(20, 'title', null, 'Second'),
      change(30, 'status', null, 'In Review'),
      change(40, 'status', null, 'Done'),
      change(50, 'title', null, 'Third'),
    ])
    expect(out.map(({ field, from, to }) => [field, from, to])).toEqual([
      ['status', null, 'In Progress'],
      ['title', null, 'Second'],
      ['status', 'In Progress', 'In Review'],
      ['status', 'In Review', 'Done'],
      ['title', 'Second', 'Third'],
    ])
  })

  it("keeps the source's own before over the restored one", () => {
    const out = withBefore([change(10, 'estimate', null, '30'), change(20, 'estimate', '45', '60')])
    expect(out[1]).toMatchObject({ from: '45', to: '60' })
  })

  it("goes by time, then by the order of the log, and keeps the log's order", () => {
    const out = withBefore([change(30, 'status', null, 'Done'), change(10, 'status', null, 'In Progress'), change(30, 'status', null, 'Closed')])
    expect(out.map(({ from, to }) => [from, to])).toEqual([
      ['In Progress', 'Done'],
      [null, 'In Progress'],
      ['Done', 'Closed'],
    ])
  })

  it('leaves a set-like field alone: an added label or link has no before', () => {
    const out = withBefore([change(10, 'label', null, 'Bug'), change(20, 'label', null, 'UI'), change(30, 'blockedBy', null, 'ABC-1'), change(40, 'relates', null, 'ABC-2')])
    expect(out.every((each) => each.from === null)).toBe(true)
  })

  it('a field cleared and set again starts from empty', () => {
    const out = withBefore([change(10, 'milestone', null, 'v1'), change(20, 'milestone', 'v1', null), change(30, 'milestone', null, 'v2')])
    expect(out[2]).toMatchObject({ from: null, to: 'v2' })
  })
})
