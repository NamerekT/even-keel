export interface Cell {
  row: number
  column: number
}

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export type Step = 'right' | 'left' | 'down'

export function snakeColumns(width: number, block: number, gap: number): number {
  return Math.max(1, Math.floor((width + gap) / (block + gap)))
}

export function snakeCell(index: number, columns: number): Cell {
  const row = Math.floor(index / columns)
  const within = index % columns
  return { row, column: row % 2 === 0 ? within : columns - 1 - within }
}

export function snakeStep(from: Cell, to: Cell): Step {
  if (from.row !== to.row) return 'down'
  return to.column > from.column ? 'right' : 'left'
}

export function arrowPath(from: Box, to: Box, step: Step): string {
  if (step === 'down') {
    const x = from.left + from.width / 2
    return `M ${x} ${from.top + from.height} L ${x} ${to.top}`
  }
  const y = from.top + from.height / 2
  return step === 'right'
    ? `M ${from.left + from.width} ${y} L ${to.left} ${y}`
    : `M ${from.left} ${y} L ${to.left + to.width} ${y}`
}

const LINK_INSET = 16

export interface LinkRoute {
  gap: number
  side: 'above' | 'below'
  lane: number
}

export function linkPath(from: Box, to: Box, { gap, side, lane }: LinkRoute): string {
  const fromX = from.left + from.width / 2 + LINK_INSET
  const toX = to.left + to.width / 2 - LINK_INSET
  const fromBottom = from.top + from.height
  const shift = gap / 3 + lane * 6
  const path = (...points: [number, number][]) => points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')

  if (from.top === to.top) {
    if (side === 'above') return path([fromX, from.top], [fromX, from.top - shift], [toX, from.top - shift], [toX, to.top])
    const bottom = to.top + to.height
    return path([fromX, fromBottom], [fromX, fromBottom + shift], [toX, fromBottom + shift], [toX, bottom])
  }
  if (to.top - fromBottom <= gap) {
    return path([fromX, fromBottom], [fromX, fromBottom + shift], [toX, fromBottom + shift], [toX, to.top])
  }
  const laneX = Math.min(from.left, to.left) - 6 - lane * 4
  return path(
    [fromX, fromBottom],
    [fromX, fromBottom + shift],
    [laneX, fromBottom + shift],
    [laneX, to.top - shift],
    [toX, to.top - shift],
    [toX, to.top],
  )
}
