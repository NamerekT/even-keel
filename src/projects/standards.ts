import { changelogPath } from '../changelog/file.js'
import type { Standard } from '../state.js'

/** The masks of the "Interface" preset: the files a screen is made of. */
export const INTERFACE_FILES = ['**/*.tsx', '**/*.jsx', '**/*.vue', '**/*.svelte', '**/*.css', '**/*.scss', '**/*.html']
/** The exceptions a new standard starts with: tests are not the screen. */
export const DEFAULT_EXCEPT = ['**/*.test.*']

const masks = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((mask) => typeof mask === 'string')
    ? [...new Set(value.map((mask: string) => mask.trim().replace(/\\/g, '/')).filter((mask) => mask !== ''))]
    : null

/**
 * The project's standards checked and normalized: the document a path inside the repository, at least one mask, one
 * standard per document; `null` — not such a list.
 */
export function standardsOf(value: unknown): Standard[] | null {
  if (!Array.isArray(value)) return null
  const found: Standard[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null
    const { doc, files, except, shots } = entry as Record<string, unknown>
    const path = typeof doc === 'string' ? changelogPath(doc) : null
    const guarded = masks(files)
    const left = except === undefined ? [] : masks(except)
    if (path === null || guarded === null || guarded.length === 0 || left === null || (shots !== undefined && typeof shots !== 'boolean')) return null
    if (found.some((standard) => standard.doc === path)) return null
    found.push({ doc: path, files: guarded, except: left, shots: shots === true })
  }
  return found
}
