import type { MemoryFact } from '../record.js'

const LINK = /\[[^\]]*\]\(([^)\s]+)\)/

/**
 * `MEMORY.md` after a pull (BTN-1645): the union merge may have doubled lines, a file may have gone or come without its
 * line. Repeated lines go, a line about a file that is not there goes, a file without a line gets one at the end
 * (`- [name](file.md) — description`, by file name). Of several lines about one file the one whose text after the
 * link is the file's frontmatter description stays, otherwise the first. Every other line is a person's and stays.
 * `files` — every record file of the folder by its name, `MEMORY.md` itself not among them.
 */
export function reindex(text: string, files: ReadonlyMap<string, MemoryFact>): string {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n')
  const seen = new Set<string>()
  const kept: (string | null)[] = []
  const byFile = new Map<string, number[]>()
  for (const line of lines) {
    if (line.trim() !== '') {
      if (seen.has(line)) continue
      seen.add(line)
    }
    const file = linkedFile(line)
    if (file === null) {
      kept.push(line)
      continue
    }
    if (!files.has(file)) continue
    byFile.set(file, [...(byFile.get(file) ?? []), kept.length])
    kept.push(line)
  }
  for (const [file, at] of byFile) {
    if (at.length < 2) continue
    const description = files.get(file)!.description.trim()
    const keep = at.find((index) => describedAs(kept[index]!, file) === description) ?? at[0]!
    for (const index of at) if (index !== keep) kept[index] = null
  }
  const missing = [...files.keys()].filter((file) => !byFile.has(file)).sort()
  const out = kept.filter((line): line is string => line !== null)
  while (out.length > 0 && out[out.length - 1]!.trim() === '') out.pop()
  for (const file of missing) out.push(indexFileLine(file, files.get(file)!))
  return out.length === 0 ? '' : `${out.join('\n')}\n`
}

export function indexFileLine(file: string, fact: Pick<MemoryFact, 'name' | 'description'>): string {
  return `- [${fact.name}](${file})${fact.description === '' ? '' : ` — ${fact.description}`}`
}

/** The record file a line of the index links to; `null` — a person's free line, or a link out of the folder. */
function linkedFile(line: string): string | null {
  const match = LINK.exec(line)
  if (match === null) return null
  const target = match[1]!
  return target.endsWith('.md') && !target.includes('/') && !target.includes('\\') && !target.includes(':') ? target : null
}

function describedAs(line: string, file: string): string {
  const link = `](${file})`
  return line
    .slice(line.indexOf(link) + link.length)
    .replace(/^\s*[—–-]\s*/, '')
    .trim()
}
