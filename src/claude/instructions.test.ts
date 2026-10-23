import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentsFallback } from './instructions.js'

describe('agentsFallback', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ek-instructions-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('gives a lone AGENTS.md', () => {
    writeFileSync(join(dir, 'AGENTS.md'), 'rules')
    expect(agentsFallback(dir)).toBe(join(dir, 'AGENTS.md'))
  })

  it('gives nothing beside a CLAUDE.md, at the root or in .claude', () => {
    writeFileSync(join(dir, 'AGENTS.md'), 'rules')
    writeFileSync(join(dir, 'CLAUDE.md'), 'rules')
    expect(agentsFallback(dir)).toBeUndefined()
    rmSync(join(dir, 'CLAUDE.md'))
    mkdirSync(join(dir, '.claude'))
    writeFileSync(join(dir, '.claude', 'CLAUDE.md'), 'rules')
    expect(agentsFallback(dir)).toBeUndefined()
  })

  it('gives nothing without an AGENTS.md', () => {
    expect(agentsFallback(dir)).toBeUndefined()
  })
})
