import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { agentSkillsDir, linkAgentSkills } from './agent-skills.js'
import { linkType, skillStore } from './share.js'

let root: string | undefined
afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  mkdirSync('.temp', { recursive: true })
  root = mkdtempSync(join('.temp', 'agent-skills-'))
  const globalDir = join(root, '.claude')
  const store = skillStore(globalDir)
  const agents = agentSkillsDir(globalDir)
  const skill = (dir: string, name: string) => {
    mkdirSync(join(dir, name), { recursive: true })
    writeFileSync(join(dir, name, 'SKILL.md'), `# ${name}\n`)
    return join(dir, name)
  }
  const lines: string[] = []
  return { root, globalDir, store, agents, skill, lines, run: () => linkAgentSkills(globalDir, (line) => { lines.push(line) }) }
}

const isLink = (path: string) => lstatSync(path).isSymbolicLink()

describe('linkAgentSkills (BTN-1691)', () => {
  it('lies in ~/.agents/skills next to the global folder', () => {
    expect(agentSkillsDir(join('home', '.claude'))).toBe(join('home', '.agents', 'skills'))
  })

  it('links each skill of the store into ~/.agents/skills once, and does nothing the second time', () => {
    const { store, agents, skill, run, lines } = fixture()
    skill(store, 'alpha')
    skill(store, 'beta')
    expect(run()).toBe(true)
    for (const name of ['alpha', 'beta']) {
      expect(isLink(join(agents, name))).toBe(true)
      expect(existsSync(join(agents, name, 'SKILL.md'))).toBe(true)
    }
    expect(lines).toHaveLength(1)
    lines.length = 0
    expect(run()).toBe(false)
    expect(lines).toEqual([])
  })

  it("leaves the user's own skills there and links pointing elsewhere", () => {
    const { root, store, agents, skill, run } = fixture()
    skill(store, 'alpha')
    skill(store, 'beta')
    skill(agents, 'alpha')
    const other = resolve(skill(join(root, 'elsewhere'), 'beta'))
    symlinkSync(other, join(agents, 'beta'), linkType(process.platform))
    expect(run()).toBe(false)
    expect(isLink(join(agents, 'alpha'))).toBe(false)
    expect(readlinkSync(join(agents, 'beta')).replace(/^\\\\\?\\/, '').replace(/[\\/]+$/, '')).toBe(other)
  })

  it('removes a link to a skill gone from the store, never a dead link elsewhere', () => {
    const { root, store, agents, skill, run } = fixture()
    skill(store, 'alpha')
    skill(store, 'beta')
    run()
    rmSync(join(store, 'beta'), { recursive: true })
    const gone = skill(join(root, 'elsewhere'), 'gamma')
    symlinkSync(gone, join(agents, 'gamma'), linkType(process.platform))
    rmSync(gone, { recursive: true })
    expect(run()).toBe(true)
    expect(lstatOrNull(join(agents, 'beta'))).toBeNull()
    expect(isLink(join(agents, 'alpha'))).toBe(true)
    expect(isLink(join(agents, 'gamma'))).toBe(true)
  })

  it('makes no ~/.agents/skills when the store has no skills, and skips the folders that are not skills', () => {
    const { store, agents, run } = fixture()
    expect(run()).toBe(false)
    mkdirSync(join(store, '.trash'), { recursive: true })
    mkdirSync(join(store, 'synced'), { recursive: true })
    expect(run()).toBe(false)
    expect(existsSync(agents)).toBe(false)
  })
})

function lstatOrNull(path: string) {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}
