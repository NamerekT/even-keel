import type { ConflictFile } from '../../../src/state.js'

/** The cells of a file's bar, as in `git diff --stat`. */
export const BAR_CELLS = 5
/** The files the Conflict fact shows before "N more files". */
export const CONFLICT_SHOWN = 8

/** The filled cells of a file's bar, by its lines against the largest file of the list; a file with lines fills one at least. */
export function conflictBar(lines: number | null, max: number): number {
  if (lines === null || lines <= 0 || max <= 0) return 0
  return Math.min(BAR_CELLS, Math.max(1, Math.round((lines / max) * BAR_CELLS)))
}

export function conflictLinesOf(files: readonly ConflictFile[]): number {
  return files.reduce((sum, file) => sum + (file.lines ?? 0), 0)
}

export function conflictMax(files: readonly ConflictFile[]): number {
  return files.reduce((max, file) => Math.max(max, file.lines ?? 0), 0)
}
