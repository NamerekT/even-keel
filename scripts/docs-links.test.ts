import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { anchorsOf, brokenLinks, brokenSections, markdownFiles } from './docs-links.ts'

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '')

describe('links between the documents', () => {
  it('every relative link of a document leads to an existing file and anchor', () => {
    expect(brokenLinks(root, markdownFiles(root))).toEqual([])
  })

  it('every prose reference to a section names the document that holds it', () => {
    expect(brokenSections(root, markdownFiles(root))).toEqual([])
  })

  it('takes a heading, a bold list item or a heading with code marks for a section', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docs-links-'))
    try {
      mkdirSync(join(dir, 'docs', 'area'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'area.md'), '# Area\r\n\r\nSubtopics in `docs/area/`.\r\n')
      writeFileSync(join(dir, 'docs', 'area', 'part.md'), '# Part\r\n\r\n## The built-in `bridge` (X-1)\r\n\r\n- **The hub away.** Text.\r\n')
      writeFileSync(
        join(dir, 'docs', 'a.md'),
        [
          'See `docs/area/part.md`, "The built-in bridge" and `docs/area/part.md` ("The hub away").',
          'Moved: `docs/area.md`, "The hub away".',
          'Gone: `docs/none.md`, "Anything".',
        ].join('\r\n'),
      )
      expect(brokenSections(dir, markdownFiles(dir))).toEqual(['docs/a.md:2 docs/area.md "The hub away"', 'docs/a.md:3 docs/none.md "Anything" (no file)'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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

  it("leaves out the chain's worktrees but keeps the rest of .claude", () => {
    const dir = mkdtempSync(join(tmpdir(), 'docs-links-'))
    try {
      mkdirSync(join(dir, '.claude', 'worktrees', 'x'), { recursive: true })
      mkdirSync(join(dir, '.claude', 'skills', 'audit'), { recursive: true })
      mkdirSync(join(dir, 'docs', 'worktrees'), { recursive: true })
      writeFileSync(join(dir, '.claude', 'worktrees', 'x', 'README.md'), 'See [gone](gone.md).\n')
      writeFileSync(join(dir, '.claude', 'skills', 'audit', 'SKILL.md'), '# Skill\n')
      writeFileSync(join(dir, 'docs', 'worktrees', 'notes.md'), '# Notes\n')
      const found = markdownFiles(dir).map((file) => relative(dir, file).split(sep).join('/')).sort()
      expect(found).toEqual(['.claude/skills/audit/SKILL.md', 'docs/worktrees/notes.md'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
