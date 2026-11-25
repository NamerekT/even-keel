import { describe, expect, it } from 'vitest'
import { brokenLinks, markdownFiles } from './docs-links.ts'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')

describe('links between the documents', () => {
  it('every relative link of a document leads to an existing file and anchor', () => {
    expect(brokenLinks(root, markdownFiles(root))).toEqual([])
  })
})
