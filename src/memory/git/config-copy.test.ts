import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runGit } from '../../git/run.js'
import { agentSkillsDir } from '../../account/agent-skills.js'
import { ConfigCopy } from './config-copy.js'
import { MEMORY_BRANCH } from './sync.js'

let root: string
let bare: string

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'even-keel-config-copy-'))
  bare = join(root, 'config.git')
  const made = await runGit(root, ['init', '-q', '--bare', '-b', MEMORY_BRANCH, bare])
  if (made.code !== 0) throw new Error(made.out)
})

afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

function machine(name: string) {
  const globalDir = join(root, name, '.claude')
  mkdirSync(globalDir, { recursive: true })
  const copy = new ConfigCopy({ globalDir, remote: bare, author: name, log: () => {}, schedule: () => () => {}, watch: () => () => {} })
  return { globalDir, copy, agents: agentSkillsDir(globalDir) }
}

describe('ConfigCopy links the skills for the other agents (BTN-1691)', { timeout: 120_000 }, () => {
  it("links a skill of the global folder at start, one synced from elsewhere after the sync, and drops one deleted", async () => {
    const a = machine('a')
    mkdirSync(join(a.globalDir, 'skills', 'review'), { recursive: true })
    writeFileSync(join(a.globalDir, 'skills', 'review', 'SKILL.md'), '# Review\n')
    await a.copy.start()
    expect(lstatSync(join(a.agents, 'review')).isSymbolicLink()).toBe(true)
    expect(existsSync(join(a.agents, 'review', 'SKILL.md'))).toBe(true)

    const b = machine('b')
    await b.copy.start()
    expect(existsSync(join(b.agents, 'review', 'SKILL.md'))).toBe(true)

    rmSync(join(a.copy.folder, 'skills', 'review'), { recursive: true })
    await a.copy.syncNow()
    expect(existsSync(join(a.agents, 'review'))).toBe(false)
    await b.copy.syncNow()
    expect(() => lstatSync(join(b.agents, 'review'))).toThrow()
    a.copy.stop()
    b.copy.stop()
  })
})
