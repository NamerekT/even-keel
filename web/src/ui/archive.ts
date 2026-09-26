import type { BlockLamp } from '../state.js'

export const ARCHIVE_PAGE = 16

export interface ArchiveView<T> {
  visible: T[]
  shown: number
  hidden: number
  next: number
}

export function archiveView<T extends { id: string; lamp: BlockLamp }>(
  blocks: T[],
  pages: number,
  focus: string,
): ArchiveView<T> {
  const closed = blocks.findIndex((block) => block.lamp !== 'done' && block.lamp !== 'canceled')
  const archived = Math.max(0, (closed < 0 ? blocks.length : closed) - 1)
  const target = blocks.findIndex((block) => block.id === focus)
  const needed = target >= 0 && target < archived ? Math.ceil((archived - target) / ARCHIVE_PAGE) : 0
  const shown = Math.min(archived, Math.max(pages, needed) * ARCHIVE_PAGE)
  const hidden = archived - shown
  return {
    visible: blocks.slice(hidden),
    shown,
    hidden,
    next: Math.min(ARCHIVE_PAGE, hidden),
  }
}
