import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export interface Row {
  id: string
  section: string
  file: string
  anchor: string
  task: string
}

export const indexRows = (text: string): Row[] => {
  const rows: Row[] = []
  let section = ''
  let inIndex = false
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('## ')) inIndex = line === '## What to check first'
    if (!inIndex) continue
    if (line.startsWith('### ')) section = line.slice(4)
    const cells = line.match(/^\| (\S+) \| \[.*?\]\(unverified\/([\w-]+\.md)#(.+?)\) \|.* \| (\S+) \|$/)
    if (cells) rows.push({ id: cells[1]!, section, file: cells[2]!, anchor: cells[3]!, task: cells[4]! })
  }
  return rows
}

/** GitHub's slug of a heading: lower case, punctuation but `_` and `-` dropped, spaces to hyphens. */
const slug = (heading: string): string => heading.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-')

export interface Entry {
  file: string
  anchor: string
  heading: string
  body: string
  start: number
  end: number
}

/** Keep physical line ranges for blame, but ignore fenced text when reading entries. */
export const entries = (docs: string): Entry[] => {
  const found: Entry[] = []
  for (const file of readdirSync(join(docs, 'unverified')).filter((name) => name.endsWith('.md')).sort()) {
    const lines = readFileSync(join(docs, 'unverified', file), 'utf8').replace(/\r\n/g, '\n').split('\n')
    if (lines.at(-1) === '') lines.pop()
    let fenced = false
    let current: Entry | undefined
    for (const [at, line] of lines.entries()) {
      if (line.startsWith('```')) { fenced = !fenced; continue }
      if (fenced) continue
      if (line.startsWith('## ')) {
        if (current) current.end = at
        current = { file, anchor: slug(line.slice(3)), heading: line.slice(3), body: '', start: at + 1, end: lines.length }
        found.push(current)
      } else if (current) current.body += `${line}\n`
    }
  }
  return found
}
