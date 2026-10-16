import { isClosedLamp, type BlockLamp } from '../state.js'

export const ARCHIVE_PAGE = 16

export interface ArchiveView<T> {
  visible: T[]
  shown: number
  hidden: number
  next: number
  /** How many of the shown and of the hidden are fixes of main that are over rather than tasks. */
  shownFixes: number
  hiddenFixes: number
}

export function archiveView<T extends { id: string; lamp: BlockLamp }>(
  blocks: T[],
  pages: number,
  focus: string,
): ArchiveView<T> {
  const closed = blocks.findIndex((block) => !isClosedLamp(block.lamp))
  const archived = Math.max(0, (closed < 0 ? blocks.length : closed) - 1)
  const target = blocks.findIndex((block) => block.id === focus)
  const needed = target >= 0 && target < archived ? Math.ceil((archived - target) / ARCHIVE_PAGE) : 0
  const shown = Math.min(archived, Math.max(pages, needed) * ARCHIVE_PAGE)
  const hidden = archived - shown
  const fixes = (part: T[]) => part.filter((block) => block.lamp === 'fixed').length
  return {
    visible: blocks.slice(hidden),
    shown,
    hidden,
    next: Math.min(ARCHIVE_PAGE, hidden),
    shownFixes: fixes(blocks.slice(hidden, archived)),
    hiddenFixes: fixes(blocks.slice(0, hidden)),
  }
}
