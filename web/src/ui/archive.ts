import { isClosedLamp, type BlockLamp } from '../state.js'

export const ARCHIVE_PAGE = 16

export interface ArchiveView<T> {
  /** The chain outside the archive. */
  visible: T[]
  /** The unfolded pages of the archive, oldest first: they show under the archive line, not in the chain. */
  archived: T[]
  shown: number
  /** The folded ones, those the server has not given yet included. */
  hidden: number
  next: number
  /** How many archived rows the page has: the live ones and the loaded older pages. */
  loaded: number
  /** How many of the shown and of the hidden are fixes of main that are over rather than tasks. */
  shownFixes: number
  hiddenFixes: number
}

/** The archive's older pages the server gave (BTN-1445), oldest first, and how many it has beyond them. */
export interface OlderRows<T> {
  rows: T[]
  left: number
}

/**
 * A closed task whose cleanup left work in its folder stays in view, out of the archive's count (BTN-332). The older
 * pages stand above the live closed blocks, those the chain holds left out, and what the server has left counts folded.
 */
export function archiveView<T extends { id: string; lamp: BlockLamp; work?: unknown }>(
  blocks: T[],
  pages: number,
  focus: string,
  older: OlderRows<T> = { rows: [], left: 0 },
): ArchiveView<T> {
  const closed = blocks.findIndex((block) => !isClosedLamp(block.lamp))
  const ids = new Set(blocks.map((block) => block.id))
  const live = blocks.slice(0, Math.max(0, (closed < 0 ? blocks.length : closed) - 1)).filter((block) => block.work === undefined)
  const archivable = [...older.rows.filter((row) => !ids.has(row.id)), ...live]
  const archived = archivable.length
  const target = archivable.findIndex((block) => block.id === focus)
  const needed = target >= 0 ? Math.ceil((archived - target) / ARCHIVE_PAGE) : 0
  const shown = Math.min(archived, Math.max(pages, needed) * ARCHIVE_PAGE)
  const hidden = archived - shown + older.left
  const gone = new Set(live)
  const fixes = (part: T[]) => part.filter((block) => block.lamp === 'fixed').length
  const from = archived - shown
  return {
    visible: blocks.filter((block) => !gone.has(block)),
    archived: archivable.slice(from),
    shown,
    hidden,
    next: Math.min(ARCHIVE_PAGE, hidden),
    loaded: archived,
    shownFixes: fixes(archivable.slice(from)),
    hiddenFixes: fixes(archivable.slice(0, from)),
  }
}
