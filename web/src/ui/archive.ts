import { isClosedLamp, type BlockLamp } from '../state.js'

export const ARCHIVE_PAGE = 16

export interface ArchiveView<T> {
  /** The chain outside the archive. */
  visible: T[]
  /** The unfolded pages of the archive, oldest first: they show under the archive line, not in the chain. */
  archived: T[]
  shown: number
  hidden: number
  next: number
  /** How many of the shown and of the hidden are fixes of main that are over rather than tasks. */
  shownFixes: number
  hiddenFixes: number
}

/** A closed task whose cleanup left work in its folder stays in view, out of the archive's count (BTN-332). */
export function archiveView<T extends { id: string; lamp: BlockLamp; work?: unknown }>(
  blocks: T[],
  pages: number,
  focus: string,
): ArchiveView<T> {
  const closed = blocks.findIndex((block) => !isClosedLamp(block.lamp))
  const archivable = blocks.slice(0, Math.max(0, (closed < 0 ? blocks.length : closed) - 1)).filter((block) => block.work === undefined)
  const archived = archivable.length
  const target = archivable.findIndex((block) => block.id === focus)
  const needed = target >= 0 ? Math.ceil((archived - target) / ARCHIVE_PAGE) : 0
  const shown = Math.min(archived, Math.max(pages, needed) * ARCHIVE_PAGE)
  const hidden = archived - shown
  const gone = new Set(archivable)
  const fixes = (part: T[]) => part.filter((block) => block.lamp === 'fixed').length
  return {
    visible: blocks.filter((block) => !gone.has(block)),
    archived: archivable.slice(hidden),
    shown,
    hidden,
    next: Math.min(ARCHIVE_PAGE, hidden),
    shownFixes: fixes(archivable.slice(hidden)),
    hiddenFixes: fixes(archivable.slice(0, hidden)),
  }
}
