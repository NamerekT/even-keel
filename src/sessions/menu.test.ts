import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CODEX } from '../codex/name.js'
import { chatMenu, frontmatterOf, pluginMenu, userMenu } from './menu.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ek-menu-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function put(path: string, text: string): void {
  const file = join(root, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

describe('frontmatterOf', () => {
  it('reads plain, quoted and folded values', () => {
    const fields = frontmatterOf('---\r\nname: review\r\ndescription: "Review the diff"\r\nargument-hint: [file]\r\n---\r\nbody\r\n')
    expect(fields).toEqual({ name: 'review', description: 'Review the diff', 'argument-hint': '[file]' })
    expect(frontmatterOf('---\ndescription: >\n  Two lines\n  in one.\nname: x\n---\n').description).toBe('Two lines in one.')
    expect(frontmatterOf('---\ndescription: |-\n  First\n  second\n---\n').description).toBe('First\nsecond')
  })

  it('gives nothing for a file without frontmatter', () => {
    expect(frontmatterOf('# Title\n')).toEqual({})
  })
})

describe('userMenu', () => {
  it('lists the commands and skills of the configuration copy with their description and argument hint', () => {
    put('commands/deploy.md', '---\ndescription: Deploy the build\nargument-hint: <env>\n---\nDeploy to $ARGUMENTS\n')
    put('skills/coding/SKILL.md', '---\nname: coding\ndescription: Working rules\n---\n')
    expect(userMenu(root)).toEqual([
      { name: 'deploy', kind: 'command', from: 'user', description: 'Deploy the build', args: '<env>' },
      { name: 'coding', kind: 'skill', from: 'user', description: 'Working rules', args: '' },
    ])
  })

  it('names a skill by its folder and leaves out one a person cannot call', () => {
    put('skills/shown/SKILL.md', '---\nname: Other Name\ndescription: d\n---\n')
    put('skills/hidden/SKILL.md', '---\ndescription: d\nuser-invocable: false\n---\n')
    put('skills/empty/notes.md', 'no skill file')
    put('commands/notes.txt', 'not a command')
    expect(userMenu(root).map((entry) => entry.name)).toEqual(['shown'])
  })

  it('gives nothing for a missing folder', () => {
    expect(userMenu(join(root, 'none'))).toEqual([])
  })
})

describe('pluginMenu', () => {
  it('names a package plugin skill and command as `<plugin>:<name>`', () => {
    put('plugin/skills/task/SKILL.md', '---\nname: task\ndescription: Working a task\n---\n')
    put('plugin/commands/sync.md', '---\ndescription: Sync\n---\n')
    expect(pluginMenu('tasks', join(root, 'plugin'))).toEqual([
      { name: 'tasks:sync', kind: 'command', from: 'package', description: 'Sync', args: '' },
      { name: 'tasks:task', kind: 'skill', from: 'package', description: 'Working a task', args: '' },
    ])
  })
})

describe('chatMenu', () => {
  beforeEach(() => {
    put('config/skills/coding/SKILL.md', '---\ndescription: c\n---\n')
    put('config/skills/loop/SKILL.md', '---\ndescription: l\n---\n')
    put('pkg/skills/task/SKILL.md', '---\ndescription: t\n---\n')
    put('pkg/skills/split/SKILL.md', '---\ndescription: s\n---\n')
  })

  it("puts the user's entries before the packages', each sorted by name", () => {
    const menu = chatMenu({ configFolder: join(root, 'config'), plugins: [{ plugin: 'tasks', dir: join(root, 'pkg') }] })
    expect(menu.map((entry) => entry.name)).toEqual(['coding', 'loop', 'tasks:split', 'tasks:task'])
  })

  it('leaves out what the overrides turn off, by the name it is called by; one only hidden from the model stays', () => {
    const menu = chatMenu({
      configFolder: join(root, 'config'),
      plugins: [{ plugin: 'tasks', dir: join(root, 'pkg') }],
      overrides: { loop: 'off', 'tasks:split': 'off', coding: 'user-invocable-only', task: 'on' },
    })
    expect(menu.map((entry) => entry.name)).toEqual(['coding', 'tasks:task'])
  })

  it('keeps the first of two entries with one name', () => {
    put('config/commands/coding.md', '---\ndescription: the command\n---\n')
    const menu = chatMenu({ configFolder: join(root, 'config'), plugins: [] })
    expect(menu.filter((entry) => entry.name === 'coding')).toEqual([{ name: 'coding', kind: 'command', from: 'user', description: 'the command', args: '' }])
  })
})

describe("chatMenu for Codex (BTN-1737)", () => {
  it('lists only skills, named by their frontmatter as Codex calls them, the folder when it has none', () => {
    put('config/commands/deploy.md', '---\ndescription: Deploy\n---\n')
    put('config/skills/coding/SKILL.md', '---\nname: coding\ndescription: c\n---\n')
    put('config/skills/review-folder/SKILL.md', '---\nname: review\ndescription: r\n---\n')
    put('config/skills/bare/SKILL.md', '---\ndescription: b\n---\n')
    put('config/skills/hidden/SKILL.md', '---\nname: hidden\nuser-invocable: false\n---\n')
    put('pkg/commands/sync.md', '---\ndescription: Sync\n---\n')
    put('pkg/skills/task-folder/SKILL.md', '---\nname: task\ndescription: t\nargument-hint: [key]\n---\n')
    const menu = chatMenu({ configFolder: join(root, 'config'), plugins: [{ plugin: 'tasks', dir: join(root, 'pkg') }], agent: CODEX })
    expect(menu).toEqual([
      { name: 'bare', kind: 'skill', from: 'user', description: 'b', args: '' },
      { name: 'coding', kind: 'skill', from: 'user', description: 'c', args: '' },
      { name: 'review', kind: 'skill', from: 'user', description: 'r', args: '' },
      { name: 'tasks:task', kind: 'skill', from: 'package', description: 't', args: '[key]' },
    ])
  })

  it("leaves out the store's own folders that are no skills, and ignores Claude's overrides", () => {
    put('config/skills/synced/SKILL.md', '---\nname: synced\n---\n')
    put('config/skills/.trash/SKILL.md', '---\nname: trash\n---\n')
    put('config/skills/loop/SKILL.md', '---\nname: loop\n---\n')
    const menu = chatMenu({ configFolder: join(root, 'config'), plugins: [], overrides: { loop: 'off' }, agent: CODEX })
    expect(menu.map((entry) => entry.name)).toEqual(['loop'])
  })

  it('gives nothing to an agent that calls no skills by name', () => {
    put('config/skills/coding/SKILL.md', '---\nname: coding\n---\n')
    expect(chatMenu({ configFolder: join(root, 'config'), plugins: [], agent: 'opencode' })).toEqual([])
  })
})
