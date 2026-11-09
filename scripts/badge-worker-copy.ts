import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'

/** Where the Worker keeps its copy of the drawing, relative to the repository. */
export const BADGE_WORKER_COPY = 'deploy/badge/src/badge'
const SOURCE = 'src/badge'
const ENTRY = 'render.ts'

export interface CopiedFile {
  /** The path inside the copy, with forward slashes. */
  name: string
  from: string
}

/**
 * The files the Worker needs from `src/badge/`: `render.ts` with every module it imports, followed by their relative
 * imports, and the fonts' licenses (SIL OFL travels with the fonts). The Deploy to Cloudflare button clones only
 * `deploy/badge/`, so it cannot import from outside it (`docs/badge.md`).
 */
export function badgeWorkerCopyFiles(root: string): CopiedFile[] {
  const source = join(root, SOURCE)
  const seen = new Set<string>()
  const queue = [ENTRY]
  while (queue.length > 0) {
    const name = queue.shift()!
    if (seen.has(name)) continue
    seen.add(name)
    const code = readFileSync(join(source, name), 'utf8')
    for (const match of code.matchAll(/^import\s[^'"]*['"](\.[^'"]+)['"]/gm)) {
      queue.push(posix.normalize(posix.join(posix.dirname(name), match[1]!.replace(/\.js$/, '.ts'))))
    }
  }
  const licenses = readdirSync(join(source, 'fonts')).filter((name) => name.endsWith('.txt')).map((name) => `fonts/${name}`)
  return [...seen, ...licenses].map((name) => ({ name, from: join(source, name) }))
}

/** Replaces the copy with the current `src/badge/`. */
export function writeBadgeWorkerCopy(root: string): CopiedFile[] {
  const target = join(root, BADGE_WORKER_COPY)
  const files = badgeWorkerCopyFiles(root)
  rmSync(target, { recursive: true, force: true })
  for (const file of files) {
    const to = join(target, file.name)
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(file.from, to)
  }
  return files
}
