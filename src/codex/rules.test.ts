import { describe, expect, it } from 'vitest'
import { parseCodexRules, strictest } from './rules.js'

describe('parseCodexRules', () => {
  it('reads the pattern and the decision of every prefix_rule as a permission', () => {
    const text = [
      '# Rules of John Doe',
      'prefix_rule(pattern=["git", "push", "--force"], decision="forbidden")',
      "prefix_rule(pattern = ['npm', 'publish'], decision = 'prompt', justification = \"Ask first\")",
      'prefix_rule(pattern=["Get-Content", "-Raw"], decision="allow")',
    ].join('\n')
    expect(parseCodexRules(text)).toEqual([
      { pattern: 'git push --force', decision: 'deny' },
      { pattern: 'npm publish', decision: 'ask' },
      { pattern: 'Get-Content -Raw', decision: 'allow' },
    ])
  })

  it('spans lines, shows alternatives in brackets and takes allow when no decision is given', () => {
    const text = 'prefix_rule(\n  pattern = [\n    "git",\n    ["push", "fetch"],  # either\n  ],\n  match = ["git push origin"],\n)\n'
    expect(parseCodexRules(text)).toEqual([{ pattern: 'git [push|fetch]', decision: 'allow' }])
  })

  it('unescapes strings and keeps a parenthesis inside one', () => {
    const text = 'prefix_rule(pattern=["C:\\\\Tools\\\\run.exe", "say \\"hi\\" (now)"], decision="forbidden")'
    expect(parseCodexRules(text)).toEqual([{ pattern: 'C:\\Tools\\run.exe say "hi" (now)', decision: 'deny' }])
  })

  it('skips what is not a prefix rule and a rule it cannot read', () => {
    const text = 'host_executable(name="git", paths=["/usr/bin/git"])\nprefix_rule(decision="forbidden")\nprefix_rule(pattern=["rm"], decision="maybe")\nprefix_rule(pattern=['
    expect(parseCodexRules(text)).toEqual([])
  })
})

describe('strictest', () => {
  it('lets deny outweigh ask and ask outweigh allow, as Codex does', () => {
    expect(strictest(['allow', 'deny', 'ask'])).toBe('deny')
    expect(strictest(['allow', 'ask'])).toBe('ask')
    expect(strictest([])).toBeUndefined()
  })
})
