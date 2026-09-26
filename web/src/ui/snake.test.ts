import { describe, expect, it } from 'vitest'
import { arrowPath, snakeCell, snakeColumns, snakeStep } from './snake.js'

describe('snakeColumns', () => {
  it('fits as many blocks with gaps as the width allows', () => {
    expect(snakeColumns(1200, 200, 40)).toBe(5)
    expect(snakeColumns(1160, 200, 40)).toBe(5)
    expect(snakeColumns(1159, 200, 40)).toBe(4)
  })

  it('never drops below one column', () => {
    expect(snakeColumns(120, 200, 40)).toBe(1)
    expect(snakeColumns(0, 200, 40)).toBe(1)
  })
})

describe('snakeCell', () => {
  it('runs even rows left to right and odd rows right to left', () => {
    const cells = Array.from({ length: 7 }, (_, index) => snakeCell(index, 3))
    expect(cells).toEqual([
      { row: 0, column: 0 },
      { row: 0, column: 1 },
      { row: 0, column: 2 },
      { row: 1, column: 2 },
      { row: 1, column: 1 },
      { row: 1, column: 0 },
      { row: 2, column: 0 },
    ])
  })

  it('stacks everything in one column', () => {
    expect([0, 1, 2].map((index) => snakeCell(index, 1))).toEqual([
      { row: 0, column: 0 },
      { row: 1, column: 0 },
      { row: 2, column: 0 },
    ])
  })
})

describe('snakeStep', () => {
  it('goes sideways within a row and down between rows', () => {
    expect(snakeStep({ row: 0, column: 0 }, { row: 0, column: 1 })).toBe('right')
    expect(snakeStep({ row: 1, column: 2 }, { row: 1, column: 1 })).toBe('left')
    expect(snakeStep({ row: 0, column: 2 }, { row: 1, column: 2 })).toBe('down')
  })
})

describe('arrowPath', () => {
  const box = (left: number, top: number) => ({ left, top, width: 200, height: 100 })

  it('joins facing edges at mid height when going sideways', () => {
    expect(arrowPath(box(0, 0), box(240, 0), 'right')).toBe('M 200 50 L 240 50')
    expect(arrowPath(box(240, 0), box(0, 0), 'left')).toBe('M 240 50 L 200 50')
  })

  it('joins the bottom of one block to the top of the next when going down', () => {
    expect(arrowPath(box(240, 0), box(240, 140), 'down')).toBe('M 340 100 L 340 140')
  })
})
