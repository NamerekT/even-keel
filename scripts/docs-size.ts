import { readFileSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { markdownFiles } from './docs-links.ts'

export const GUIDE_CEILING = 30_000
export const AREA_CEILING = 40_000
/** `docs/design.md` is given whole to a session by the project's standard, so it cannot be cut into subtopics. */
export const EXCEPTIONS: Readonly<Record<string, number>> = { 'docs/design.md': 45_000 }

/** The logs have rules of their own (the `unverified-audit` skill); they are not read whole. */
export const isJournal = (path: string): boolean => /^docs\/(?:verified|unverified|posts)(?:\/|\.md$)/.test(path)

export const ceilingOf = (path: string): number | null => {
  if (!path.startsWith('docs/') || !path.endsWith('.md') || isJournal(path)) return null
  return EXCEPTIONS[path] ?? (path.startsWith('docs/guide/') ? GUIDE_CEILING : AREA_CEILING)
}

/** A file's size as git stores it: a Windows checkout's CRLF counts as LF, so the ceiling is the same as on CI. */
export const lfBytes = (path: string): number => {
  const bytes = readFileSync(path)
  let crlf = 0
  for (let i = 0; i < bytes.length - 1; i++) if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) crlf++
  return bytes.length - crlf
}

/** The pages and documents above their ceiling, as `path (bytes, ceiling)`. */
export const oversized = (root: string, sizes?: ReadonlyMap<string, number>): string[] => {
  const found: string[] = []
  const paths = sizes ? [...sizes.keys()] : markdownFiles(root).map((file) => relative(root, file).split(sep).join('/'))
  for (const path of paths) {
    const ceiling = ceilingOf(path)
    if (ceiling === null) continue
    const bytes = sizes ? sizes.get(path)! : lfBytes(`${root}/${path}`)
    if (bytes > ceiling) found.push(`${path} (${bytes} bytes, ceiling ${ceiling})`)
  }
  return found
}
