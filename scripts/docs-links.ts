import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

/** GitHub's anchor of a heading's text. */
export const slugOf = (heading: string): string =>
  heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')

/** Every anchor of a markdown text, headings outside code fences, with GitHub's `-1` suffix for repeats. */
export const anchorsOf = (text: string): Set<string> => {
  const seen = new Map<string, number>()
  const found = new Set<string>()
  let fenced = false
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('```')) fenced = !fenced
    const match = !fenced && /^#{1,6}\s+(.*)$/.exec(line)
    if (!match) continue
    const slug = slugOf(match[1]!)
    const count = seen.get(slug) ?? 0
    seen.set(slug, count + 1)
    found.add(count === 0 ? slug : `${slug}-${count}`)
  }
  return found
}

export const markdownFiles = (root: string, skip: ReadonlySet<string> = new Set(['node_modules', '.git', '.temp', 'dist', 'state'])): string[] => {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith('.md')) out.push(path)
    }
  }
  walk(root)
  return out
}

/** Relative markdown links of a file that lead nowhere: a missing file or a missing anchor. */
export const brokenLinks = (root: string, files: string[]): string[] => {
  const anchors = new Map<string, Set<string>>()
  const anchorsIn = (path: string): Set<string> => {
    let set = anchors.get(path)
    if (!set) anchors.set(path, (set = anchorsOf(readFileSync(path, 'utf8'))))
    return set
  }
  const broken: string[] = []
  for (const file of files) {
    let fenced = false
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
      if (line.startsWith('```')) fenced = !fenced
      if (fenced) return
      const stripped = line.replace(/`[^`]*`/g, '')
      for (const match of stripped.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = match[1]!
        if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue
        const [pathPart = '', anchor] = target.split('#') as [string, string | undefined]
        const path = pathPart === '' ? file : resolve(dirname(file), pathPart)
        const where = `${relative(root, file).split(sep).join('/')}:${index + 1} ${target}`
        if (!existsSync(path)) broken.push(`${where} (no file)`)
        else if (anchor && path.endsWith('.md') && !anchorsIn(path).has(decodeURIComponent(anchor))) broken.push(`${where} (no anchor)`)
      }
    })
  }
  return broken
}
