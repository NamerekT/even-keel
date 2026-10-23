import { describe, expect, it } from 'vitest'
import { fallbackPassed, instructionsFor, passedSkillFolders, pluginReach, repoRulesOf, skillFoldersFor } from './projectRules.js'

describe('instructionsFor', () => {
  it('gives a lone file to every agent', () => {
    for (const agent of ['claude', 'codex', 'opencode', 'copilot']) {
      expect(instructionsFor(agent, ['CLAUDE.md'])).toEqual(['CLAUDE.md'])
      expect(instructionsFor(agent, ['AGENTS.md'])).toEqual(['AGENTS.md'])
    }
  })

  it('gives each agent its own file of two, and Copilot both', () => {
    const both = ['CLAUDE.md', 'AGENTS.md'] as const
    expect(instructionsFor('claude', both)).toEqual(['CLAUDE.md'])
    expect(instructionsFor('codex', both)).toEqual(['AGENTS.md'])
    expect(instructionsFor('opencode', both)).toEqual(['AGENTS.md'])
    expect(instructionsFor('copilot', both)).toEqual(['CLAUDE.md', 'AGENTS.md'])
  })

  it('gives nothing without files or for an unknown agent', () => {
    expect(instructionsFor('claude', [])).toEqual([])
    expect(instructionsFor('other', ['CLAUDE.md'])).toEqual([])
  })

  it("tells the lone file Even Keel gives from one the agent finds itself", () => {
    expect(fallbackPassed('claude', ['AGENTS.md'])).toBe(true)
    expect(fallbackPassed('claude', ['CLAUDE.md'])).toBe(false)
    expect(fallbackPassed('codex', ['CLAUDE.md'])).toBe(true)
    expect(fallbackPassed('codex', ['CLAUDE.md', 'AGENTS.md'])).toBe(false)
    expect(fallbackPassed('opencode', ['CLAUDE.md'])).toBe(false)
    expect(fallbackPassed('copilot', ['AGENTS.md'])).toBe(false)
  })
})

describe('pluginReach', () => {
  it('names what of a plugin package each agent gets', () => {
    expect(['claude', 'codex', 'copilot', 'opencode', 'other'].map(pluginReach)).toEqual(['all', 'all', 'all', 'skills', 'servers'])
  })
})

describe('skill folders', () => {
  it('names what each agent reads, with what Even Keel passes', () => {
    expect(skillFoldersFor('claude')).toEqual(['.claude/skills'])
    expect(skillFoldersFor('codex')).toEqual(['.agents/skills', '.codex/skills'])
    expect(skillFoldersFor('opencode')).toEqual(['.opencode/skills', '.claude/skills', '.agents/skills'])
    expect(skillFoldersFor('copilot')).toEqual(['.github/skills', '.agents/skills', '.claude/skills'])
    expect(passedSkillFolders('opencode')).toEqual(['.claude/skills', '.agents/skills'])
    expect(passedSkillFolders('claude')).toEqual([])
  })
})

describe('repoRulesOf', () => {
  it('finds the root instruction files and the skills one level down', () => {
    const rules = repoRulesOf([
      'AGENTS.md',
      'CLAUDE.md',
      'docs/CLAUDE.md',
      '.claude/CLAUDE.md',
      '.claude/skills/review/SKILL.md',
      '.claude/skills/review/notes.md',
      '.claude/skills/deep/nested/SKILL.md',
      '.claude/skills/build/SKILL.md',
      '.agents/skills/ship/SKILL.md',
      '.claude/settings.json',
    ])
    expect(rules).toEqual({
      files: ['CLAUDE.md', 'AGENTS.md'],
      skills: [
        { folder: '.claude/skills', names: ['build', 'review'] },
        { folder: '.agents/skills', names: ['ship'] },
      ],
    })
  })

  it('is empty for a repository with no rules', () => {
    expect(repoRulesOf(['README.md', 'src/index.ts'])).toEqual({ files: [], skills: [] })
  })
})
