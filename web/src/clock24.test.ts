import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Read from the disk, not through `import.meta.glob`: vitest's module cache freezes a glob's file list.
const root = fileURLToPath(new URL('.', import.meta.url))
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]))
const sources = walk(root).filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))

/** The argument list of each `new Intl.DateTimeFormat(` call, up to its closing parenthesis. */
function formatterCalls(text: string): string[] {
  const calls: string[] = []
  for (let at = text.indexOf('new Intl.DateTimeFormat('); at !== -1; at = text.indexOf('new Intl.DateTimeFormat(', at + 1)) {
    let depth = 0
    let end = at + 'new Intl.DateTimeFormat'.length
    for (; end < text.length; end++) {
      if (text[end] === '(') depth++
      else if (text[end] === ')' && --depth === 0) break
    }
    calls.push(text.slice(at, end + 1))
  }
  return calls
}

describe('a time on the page', () => {
  it('is a 24-hour clock in every language: each formatter that shows hours sets hourCycle h23', () => {
    const offenders = sources.flatMap((file) =>
      formatterCalls(readFileSync(file, 'utf8'))
        .filter((call) => /\bhour\b|timeStyle/.test(call) && !call.includes("hourCycle: 'h23'"))
        .map((call) => `${relative(root, file).replaceAll('\\', '/')}: ${call}`),
    )
    expect(offenders).toEqual([])
  })
})
