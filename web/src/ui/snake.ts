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
