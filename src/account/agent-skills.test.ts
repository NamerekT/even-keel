import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { agentSkillsDir, linkAgentSkills } from './agent-skills.js'
import { configStore, linkType, skillStore } from './share.js'

let root: string | undefined
afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
})

function fixture({ repository = true } = {}) {
  mkdirSync('.temp', { recursive: true })
  root = mkdtempSync(join('.temp', 'agent-skills-'))
  const globalDir = join(root, '.claude')
  const store = skillStore(globalDir)
  const agents = agentSkillsDir(globalDir)
  const claude = join(globalDir, 'skills')
  if (repository) mkdirSync(join(configStore(globalDir), '.git'), { recursive: true })
  const skill = (dir: string, name: string) => {
    mkdirSync(join(dir, name), { recursive: true })
    writeFileSync(join(dir, name, 'SKILL.md'), `# ${name}\n`)
    return join(dir, name)
  }
  const lines: string[] = []
  return { root, globalDir, store, agents, claude, skill, lines, run: () => linkAgentSkills(globalDir, (line) => { lines.push(line) }) }
}

const isLink = (path: string) => lstatSync(path).isSymbolicLink()
const targetOf = (path: string) => readlinkSync(path).replace(/^\\\\\?\\/, '').replace(/[\\/]+$/, '')

describe('linkAgentSkills (BTN-1691)', () => {
  it('lies in ~/.agents/skills next to the global folder', () => {
    expect(agentSkillsDir(join('home', '.claude'))).toBe(join('home', '.agents', 'skills'))
  })

  it('links each skill of the store into ~/.agents/skills and ~/.claude/skills once, and does nothing the second time', () => {
    const { store, agents, claude, skill, run, lines } = fixture()
    skill(store, 'alpha')
    skill(store, 'beta')
    expect(run()).toBe(true)
    for (const dir of [agents, claude]) {
      for (const name of ['alpha', 'beta']) {
        expect(isLink(join(dir, name))).toBe(true)
        expect(existsSync(join(dir, name, 'SKILL.md'))).toBe(true)
      }
    }
    expect(lines).toHaveLength(2)
    lines.length = 0
    expect(run()).toBe(false)
    expect(lines).toEqual([])
  })

  it("leaves the user's own skills there and links pointing elsewhere", () => {
    const { root, store, agents, skill, run } = fixture()
    skill(store, 'alpha')
    skill(store, 'beta')
    run()
    rmSync(join(agents, 'alpha'))
    rmSync(join(agents, 'beta'))
    skill(agents, 'alpha')
    const other = resolve(skill(join(root, 'elsewhere'), 'beta'))
    symlinkSync(other, join(agents, 'beta'), linkType(process.platform))
    expect(run()).toBe(false)
    expect(isLink(join(agents, 'alpha'))).toBe(false)
    expect(targetOf(join(agents, 'beta'))).toBe(other)
  })

  it('removes the links to a skill gone from the store, never a dead link elsewhere', () => {
    const { root, store, agents, claude, skill, run, lines } = fixture()
    skill(store, 'alpha')
    skill(store, 'beta')
    run()
    rmSync(join(store, 'beta'), { recursive: true })
    const gone = skill(join(root, 'elsewhere'), 'gamma')
    symlinkSync(gone, join(agents, 'gamma'), linkType(process.platform))
    symlinkSync(gone, join(claude, 'gamma'), linkType(process.platform))
    rmSync(gone, { recursive: true })
    lines.length = 0
    expect(run()).toBe(true)
    for (const dir of [agents, claude]) {
      expect(lstatOrNull(join(dir, 'beta'))).toBeNull()
      expect(isLink(join(dir, 'alpha'))).toBe(true)
      expect(isLink(join(dir, 'gamma'))).toBe(true)
    }
    expect(lines.join('\n')).toContain('removed beta, gone from the store')
  })

  it('makes no skill folders when the store has no skills, and skips the folders that are not skills', () => {
    const { store, agents, claude, run } = fixture()
    expect(run()).toBe(false)
    mkdirSync(join(store, '.trash'), { recursive: true })
    mkdirSync(join(store, 'synced'), { recursive: true })
    expect(run()).toBe(false)
    expect(existsSync(agents)).toBe(false)
    expect(existsSync(claude)).toBe(false)
  })
})

describe('linkAgentSkills: a skill deleted from ~/.claude/skills (BTN-1736)', () => {
  it('deletes the skill from the store and its ~/.agents/skills link, the other skills stay', () => {
    const { store, agents, claude, skill, run, lines } = fixture()
    skill(store, 'alpha')
    skill(store, 'beta')
    run()
    rmSync(join(claude, 'beta'), { recursive: true, force: true })
    lines.length = 0
    expect(run()).toBe(true)
    expect(existsSync(join(store, 'beta'))).toBe(false)
    expect(lstatOrNull(join(agents, 'beta'))).toBeNull()
    expect(lstatOrNull(join(claude, 'beta'))).toBeNull()
    expect(existsSync(join(store, 'alpha', 'SKILL.md'))).toBe(true)
    expect(isLink(join(agents, 'alpha'))).toBe(true)
    expect(lines.join('\n')).toContain('deleted beta from the store')
    lines.length = 0
    expect(run()).toBe(false)
  })

  it('links a skill new in the store, such as one a sync brought, instead of deleting it', () => {
    const { store, claude, skill, run } = fixture()
    skill(store, 'alpha')
    run()
    skill(store, 'beta')
    expect(run()).toBe(true)
    expect(isLink(join(claude, 'beta'))).toBe(true)
    expect(existsSync(join(store, 'beta', 'SKILL.md'))).toBe(true)
  })

  it('deletes nothing when the whole ~/.claude/skills is gone: the links come back', () => {
    const { store, claude, skill, run } = fixture()
    skill(store, 'alpha')
    run()
    rmSync(claude, { recursive: true })
    expect(run()).toBe(true)
    expect(isLink(join(claude, 'alpha'))).toBe(true)
    expect(existsSync(join(store, 'alpha', 'SKILL.md'))).toBe(true)
  })

  it('deletes nothing without the working copy of the store: the link comes back', () => {
    const { store, claude, skill, run } = fixture({ repository: false })
    skill(store, 'alpha')
    run()
    rmSync(join(claude, 'alpha'))
    expect(run()).toBe(true)
    expect(isLink(join(claude, 'alpha'))).toBe(true)
    expect(existsSync(join(store, 'alpha', 'SKILL.md'))).toBe(true)
  })

  it('keeps a skill whose ~/.claude/skills entry became a folder or a link elsewhere', () => {
    const { root, store, claude, skill, run } = fixture()
    skill(store, 'alpha')
    skill(store, 'beta')
    run()
    rmSync(join(claude, 'alpha'))
    skill(claude, 'alpha')
    rmSync(join(claude, 'beta'))
    const other = resolve(skill(join(root, 'elsewhere'), 'beta'))
    symlinkSync(other, join(claude, 'beta'), linkType(process.platform))
    run()
    expect(existsSync(join(store, 'alpha', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(store, 'beta', 'SKILL.md'))).toBe(true)
    expect(isLink(join(claude, 'alpha'))).toBe(false)
    expect(targetOf(join(claude, 'beta'))).toBe(other)
  })
})

function lstatOrNull(path: string) {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}
