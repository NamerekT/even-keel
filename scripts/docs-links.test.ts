import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { anchorsOf, brokenLinks, markdownFiles } from './docs-links.ts'

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '')

describe('links between the documents', () => {
  it('every relative link of a document leads to an existing file and anchor', () => {
    expect(brokenLinks(root, markdownFiles(root))).toEqual([])
  })

  it('reads the anchors of a CRLF checkout', () => {
    expect(anchorsOf('# Top\r\n\r\n```\r\n# not a heading\r\n```\r\n## Sub part\r\n')).toEqual(new Set(['top', 'sub-part']))
  })

  it('finds no broken link in CRLF files whose links hold', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docs-links-'))
    try {
      writeFileSync(join(dir, 'a.md'), '# A\r\n\r\nSee [b](b.md#part-two).\r\n')
      writeFileSync(join(dir, 'b.md'), '# B\r\n\r\n## Part two\r\n')
      expect(brokenLinks(dir, markdownFiles(dir))).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
