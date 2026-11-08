import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isInside } from '../paths.js'
import { agentsFallback, claudeRulesAbove } from './instructions.js'

describe('agentsFallback', () => {
  let root: string
  let project: string
  // The machine's own folders above the temp folder stay out of it: `~/.claude/CLAUDE.md` is one of them.
  const exists = (path: string) => isInside(path, root) && existsSync(path)
  const write = (path: string) => {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, 'rules')
  }
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ek-instructions-'))
    project = join(root, 'home', 'project')
    mkdirSync(project, { recursive: true })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('gives nothing for a lone AGENTS.md with no rules file above: the CLI reads it by itself', () => {
    write(join(project, 'AGENTS.md'))
    expect(agentsFallback(project, exists)).toBeUndefined()
  })

  it('gives a lone AGENTS.md below a CLAUDE.md or .claude/CLAUDE.md of any folder above', () => {
    write(join(project, 'AGENTS.md'))
    write(join(root, 'CLAUDE.md'))
    expect(agentsFallback(project, exists)).toBe(join(project, 'AGENTS.md'))
    rmSync(join(root, 'CLAUDE.md'))
    write(join(root, 'home', '.claude', 'CLAUDE.md'))
    expect(agentsFallback(project, exists)).toBe(join(project, 'AGENTS.md'))
  })

  it('gives nothing beside a CLAUDE.md, at the root or in .claude', () => {
    write(join(project, 'AGENTS.md'))
    write(join(root, 'CLAUDE.md'))
    write(join(project, 'CLAUDE.md'))
    expect(agentsFallback(project, exists)).toBeUndefined()
    rmSync(join(project, 'CLAUDE.md'))
    write(join(project, '.claude', 'CLAUDE.md'))
    expect(agentsFallback(project, exists)).toBeUndefined()
  })

  it('gives nothing without an AGENTS.md', () => {
    write(join(root, 'CLAUDE.md'))
    expect(agentsFallback(project, exists)).toBeUndefined()
  })

  describe('in a git worktree inside its main checkout', () => {
    let worktree: string
    beforeEach(() => {
      worktree = join(project, '.claude', 'worktrees', 'abc-1')
      const gitdir = join(project, '.git', 'worktrees', 'abc-1')
      mkdirSync(gitdir, { recursive: true })
      writeFileSync(join(gitdir, 'commondir'), '../..\n')
      mkdirSync(worktree, { recursive: true })
      writeFileSync(join(worktree, '.git'), `gitdir: ${gitdir.replaceAll('\\', '/')}\n`)
      write(join(worktree, 'AGENTS.md'))
    })

    it("does not count the checkout's own CLAUDE.md", () => {
      write(join(project, 'CLAUDE.md'))
      write(join(project, '.claude', 'CLAUDE.md'))
      expect(claudeRulesAbove(worktree, exists)).toBeNull()
      expect(agentsFallback(worktree, exists)).toBeUndefined()
    })

    it('counts a CLAUDE.md above the checkout', () => {
      write(join(project, 'CLAUDE.md'))
      write(join(root, 'home', '.claude', 'CLAUDE.md'))
      expect(claudeRulesAbove(worktree, exists)).toBe(join(root, 'home', '.claude', 'CLAUDE.md'))
      expect(agentsFallback(worktree, exists)).toBe(join(worktree, 'AGENTS.md'))
    })
  })
})
