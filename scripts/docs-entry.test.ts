import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const docs = new URL('../docs/', import.meta.url)
const entry = (): string => readFileSync(new URL('README.md', docs), 'utf8')
const targets = (): string[] =>
  [...entry().matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)].map((match) => match[1]!).filter((target) => !/^[a-z]+:/.test(target))

describe('docs/README.md', () => {
  it('links only to files that exist', () => {
    const missing = targets().filter((target) => !existsSync(new URL(target, docs)))
    expect(missing).toEqual([])
  })

  it('links every document and folder at the top of docs/', () => {
    const linked = new Set(targets().map((target) => target.replace(/\/.*$/, '')))
    const unlisted = readdirSync(docs, { withFileTypes: true })
      .filter((item) => item.name !== 'README.md' && (item.isDirectory() || item.name.endsWith('.md')))
      .filter((item) => !linked.has(item.name) && !(item.isDirectory() && linked.has(`${item.name}.md`)))
      .map((item) => item.name)
    expect(unlisted).toEqual([])
  })

  it('carries no task ids', () => {
    expect(entry()).not.toMatch(/\b(BTN|EKR)-\d+/)
  })
})
