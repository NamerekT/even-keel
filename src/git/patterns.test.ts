import { describe, expect, it } from 'vitest'
import { compilePatterns, matchesPath, mayHold } from './patterns.js'

const match = (patterns: string[], path: string, dir = false) => matchesPath(compilePatterns(patterns), path, dir)

describe('compilePatterns (.gitignore syntax, BTN-1315)', () => {
  it('matches everything inside a folder with /** but not the folder itself', () => {
    expect(match(['.temp/**'], '.temp/record/a.png')).toBe(true)
    expect(match(['.temp/**'], '.temp/bot', true)).toBe(true)
    expect(match(['.temp/**'], '.temp', true)).toBe(false)
    expect(match(['.temp/**'], 'src/.temp/a.png')).toBe(false)
  })

  it('takes a trailing slash as a folder only, with everything in it', () => {
    expect(match(['.temp/notes/'], '.temp/notes', true)).toBe(true)
    expect(match(['.temp/notes/'], '.temp/notes')).toBe(false)
    expect(match(['.temp/notes/'], '.temp/notes/a/b.txt')).toBe(true)
  })

  it('matches a pattern without a slash at any depth', () => {
    expect(match(['*.md'], 'a.md')).toBe(true)
    expect(match(['*.md'], '.temp/x/a.md')).toBe(true)
    expect(match(['*.md'], '.temp/x/a.mdx')).toBe(false)
  })

  it('anchors a pattern with a slash to the root, a leading slash included', () => {
    expect(match(['/.temp/*.log'], '.temp/a.log')).toBe(true)
    expect(match(['.temp/*.log'], '.temp/x/a.log')).toBe(false)
    expect(match(['.temp/*.log'], 'x/.temp/a.log')).toBe(false)
  })

  it('takes **/ as any number of folders, none included', () => {
    expect(match(['.temp/**/*.md'], '.temp/a.md')).toBe(true)
    expect(match(['.temp/**/*.md'], '.temp/a/b/c.md')).toBe(true)
    expect(match(['**/saves'], 'a/b/saves', true)).toBe(true)
    expect(match(['**/saves'], 'saves', true)).toBe(true)
  })

  it('knows ?, classes and escapes, and skips blanks and comments', () => {
    expect(match(['.temp/run-?'], '.temp/run-1')).toBe(true)
    expect(match(['.temp/run-[0-9]'], '.temp/run-x')).toBe(false)
    expect(match(['.temp/run-[!0-9]'], '.temp/run-x')).toBe(true)
    expect(match(['.temp/\\*'], '.temp/*')).toBe(true)
    expect(match(['.temp/\\*'], '.temp/a')).toBe(false)
    expect(match(['', '  ', '# .temp/**'], '.temp/a')).toBe(false)
  })

  it('treats regex characters literally', () => {
    expect(match(['.temp/a+b.(1)'], '.temp/a+b.(1)')).toBe(true)
    expect(match(['.temp/a+b.(1)'], '.temp/aab.(1)')).toBe(false)
  })
})

describe('mayHold', () => {
  const rules = compilePatterns(['.temp/**', '.cache/run/*.log'])

  it('goes into the folders on the way to an anchored pattern and below its literal start', () => {
    expect(mayHold(rules, '.temp')).toBe(true)
    expect(mayHold(rules, '.temp/record/deep')).toBe(true)
    expect(mayHold(rules, '.cache')).toBe(true)
    expect(mayHold(rules, '.cache/run')).toBe(true)
  })

  it('skips the folders no pattern can reach', () => {
    expect(mayHold(rules, 'Library')).toBe(false)
    expect(mayHold(rules, '.cache/other')).toBe(false)
  })

  it('goes everywhere for a pattern without a slash', () => {
    expect(mayHold(compilePatterns(['*.log']), 'Library/deep')).toBe(true)
    expect(mayHold(compilePatterns(['**/*.log']), 'Library/deep')).toBe(true)
  })
})
