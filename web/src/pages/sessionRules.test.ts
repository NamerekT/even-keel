import { describe, expect, it } from 'vitest'
import type { PackagesView, PackageView } from '../../../src/state.js'
import { sessionGets } from './sessionRules.js'

const plugin = (name: string, extras: boolean): PackageView => ({
  name,
  kind: 'plugin',
  installed: true,
  version: '1.0.0',
  latest: null,
  fetched: null,
  installing: false,
  error: null,
  note: null,
  default: true,
  settings: {},
  servers: [],
  extras,
  removed: false,
})

const packages: PackagesView = {
  gateway: null,
  packages: [plugin('checkpoint', true), plugin('servers-only', false), plugin('off', true)],
  projects: {
    ABC: {
      cells: {
        checkpoint: { choice: null, enabled: true, settings: {}, problems: [] },
        'servers-only': { choice: null, enabled: true, settings: {}, problems: [] },
        off: { choice: 'off', enabled: false, settings: {}, problems: [] },
      },
      problems: [],
      blocked: false,
      tracker: null,
    },
  },
  keys: [],
  available: [],
  marketplace: null,
  imports: {},
  skills: { package: 'my-skills@even-keel-skills', list: [] },
}

const rules = { files: ['CLAUDE.md' as const], skills: [{ folder: '.claude/skills' as const, names: ['review'] }] }
const noPrompts = { shared: false, project: false }

describe('sessionGets', () => {
  it("gives Claude its CLAUDE.md, the project's skills and the plugins with their hooks", () => {
    expect(sessionGets('claude', rules, { shared: true, project: false }, packages, 'ABC')).toEqual({
      files: ['CLAUDE.md'],
      unread: [],
      passed: false,
      prompts: { shared: true, project: false },
      skills: ['review'],
      missed: [],
      packages: [{ name: 'checkpoint', hooks: true }],
      none: false,
    })
  })

  it('marks the lone file Even Keel passes and the skill folders the agent does not read', () => {
    const gets = sessionGets('codex', rules, noPrompts, packages, 'ABC')
    expect(gets.files).toEqual(['CLAUDE.md'])
    expect(gets.passed).toBe(true)
    expect(gets.skills).toEqual([])
    expect(gets.missed).toEqual([{ folder: '.claude/skills', names: ['review'] }])
  })

  it("names the other agent's file as unread when both are there", () => {
    const gets = sessionGets('opencode', { files: ['CLAUDE.md', 'AGENTS.md'], skills: [] }, noPrompts, packages, 'ABC')
    expect(gets.files).toEqual(['AGENTS.md'])
    expect(gets.unread).toEqual(['CLAUDE.md'])
    expect(gets.packages).toEqual([{ name: 'checkpoint', hooks: false }])
  })

  it('says there are no rules when nothing of the project reaches the session', () => {
    expect(sessionGets('codex', { files: [], skills: [{ folder: '.claude/skills', names: ['review'] }] }, noPrompts, null, 'ABC').none).toBe(true)
    expect(sessionGets('codex', { files: [], skills: [] }, { shared: false, project: true }, null, 'ABC').none).toBe(false)
  })
})
