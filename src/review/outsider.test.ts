import { describe, expect, it } from 'vitest'
import { filesOf, guardedFiles, outsiderHold } from './outsider.js'

describe('guardedFiles (BTN-1207)', () => {
  it('takes the CI workflows at the root and the agent’s files and package.json at any level', () => {
    const files = [
      '.github/workflows/ci.yml',
      '.forgejo/workflows/test.yaml',
      '.gitea/workflows/a.yml',
      '.gitlab-ci.yml',
      '.claude/settings.json',
      '.claude/hooks/check.mjs',
      'web/.claude/skills/x/SKILL.md',
      'CLAUDE.md',
      'docs/AGENTS.md',
      '.codex/rules/default.rules',
      'package.json',
      'web/package.json',
      'web\\CLAUDE.md',
    ]
    expect(guardedFiles(files)).toEqual(files)
  })

  it('leaves everything else, a look-alike name or folder included', () => {
    expect(guardedFiles(['src/workflows/ci.yml', 'docs/.github/workflows/ci.yml', 'sub/.gitlab-ci.yml', 'CLAUDE.md.bak', 'docs/claude.md', 'package-lock.json', 'src/claude/index.ts', '.github/ISSUE_TEMPLATE/bug.yml'])).toEqual([])
  })
})

describe('filesOf', () => {
  it('takes a list of paths and nothing else', () => {
    expect(filesOf({ files: ['a', '.github/workflows/ci.yml'] })).toEqual(['a', '.github/workflows/ci.yml'])
    expect(filesOf({ files: [] })).toEqual([])
    for (const body of [null, 'x', {}, { files: 'a' }, { files: [1] }, { files: [''] }]) expect(filesOf(body)).toBeNull()
  })
})

describe('outsiderHold', () => {
  it('names the first three files and how many more, and the step it holds', () => {
    expect(outsiderHold('ABC-7', ['a', 'b', 'c', 'd', 'e'], true)).toEqual({
      code: 'review.outsiderFiles',
      params: { task: 'ABC-7', files: ['a', 'b', 'c'], more: 2, pull: true },
      detail: 'a\nb\nc\nd\ne',
    })
    expect(outsiderHold('ABC-7', ['a'], false)).toEqual({ code: 'review.outsiderFiles', params: { task: 'ABC-7', files: ['a'], more: 0 } })
    expect(outsiderHold('ABC-7', [], false, 'fatal: bad revision')).toMatchObject({ params: { files: [] }, detail: 'fatal: bad revision' })
  })
})
