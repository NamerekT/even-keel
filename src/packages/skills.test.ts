import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { availablePlugins, locatePlugin, pluginVersion } from './plugins.js'
import { chosenSkills, listSkills, rewrapSkills, skillsChanged, skillsVersion, SKILLS_MARKETPLACE, SKILLS_PLUGIN, wrappedSkills, wrapSkills, type SkillRoot } from './skills.js'

let dir: string | undefined
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function skill(root: string, name: string, text = `# ${name}`): void {
  mkdirSync(join(root, name), { recursive: true })
  writeFileSync(join(root, name, 'SKILL.md'), text)
}

/** A Claude skills folder with `review` and `notes`, a Codex one with `notes` again and `deploy`. */
function folders(): { roots: SkillRoot[]; claude: string; codex: string; market: string } {
  dir = mkdtempSync(join(tmpdir(), 'even-keel-skills-'))
  const claude = join(dir, 'claude', 'skills')
  const codex = join(dir, 'codex', 'skills')
  skill(claude, 'review')
  skill(claude, 'notes')
  skill(codex, 'notes', '# codex notes')
  skill(codex, 'deploy')
  return { roots: [{ dir: claude, from: 'claude' }, { dir: codex, from: 'codex' }], claude, codex, market: join(dir, 'state', 'skills') }
}

describe('listSkills', () => {
  it('lists the folders with a SKILL.md, the first folder winning a name', () => {
    const { roots, claude } = folders()
    expect(listSkills(roots).map(({ name, from }) => `${name}:${from}`)).toEqual(['deploy:codex', 'notes:claude', 'review:claude'])
    expect(listSkills(roots).find((each) => each.name === 'notes')?.dir).toBe(join(claude, 'notes'))
  })

  it("skips dot folders, the account's synced and folders without a SKILL.md", () => {
    const { roots, claude, codex } = folders()
    skill(codex, '.system')
    skill(claude, 'synced')
    mkdirSync(join(claude, 'empty'))
    expect(listSkills(roots).map((each) => each.name)).toEqual(['deploy', 'notes', 'review'])
  })

  it('reads nothing from a folder that does not exist', () => {
    expect(listSkills([{ dir: join(tmpdir(), 'even-keel-no-such-folder'), from: 'codex' }])).toEqual([])
  })
})

describe('skillsVersion', () => {
  it('is stable for the same files and changes with an edit', () => {
    const { claude } = folders()
    const set = [{ name: 'review', dir: join(claude, 'review') }]
    const before = skillsVersion(set)
    expect(before).toMatch(/^1\.0\.0\+[0-9a-f]{8}$/)
    expect(skillsVersion(set)).toBe(before)
    writeFileSync(join(claude, 'review', 'SKILL.md'), '# review, edited')
    expect(skillsVersion(set)).not.toBe(before)
  })

  it('does not depend on the order of the skills', () => {
    const { claude } = folders()
    const review = { name: 'review', dir: join(claude, 'review') }
    const notes = { name: 'notes', dir: join(claude, 'notes') }
    expect(skillsVersion([review, notes])).toBe(skillsVersion([notes, review]))
  })
})

describe('skillsChanged', () => {
  it('is any other version, since a hash has no order', () => {
    expect(skillsChanged('1.0.0+aaaaaaaa', '1.0.0+bbbbbbbb')).toBe(true)
    expect(skillsChanged('1.0.0+aaaaaaaa', '1.0.0+aaaaaaaa')).toBe(false)
    expect(skillsChanged(null, '1.0.0+aaaaaaaa')).toBe(false)
  })
})

describe('wrapSkills', () => {
  it('writes a marketplace whose plugin the packages find and install', () => {
    const { roots, market } = folders()
    const version = wrapSkills(market, chosenSkills(market, roots, ['review', 'deploy']))
    expect(wrappedSkills(market).sort()).toEqual(['deploy', 'review'])
    const globalDir = join(dir!, 'global')
    expect(availablePlugins(globalDir, [market])).toEqual([{ plugin: SKILLS_PLUGIN, marketplace: SKILLS_MARKETPLACE }])
    const place = locatePlugin(globalDir, SKILLS_PLUGIN, SKILLS_MARKETPLACE, [market])
    expect(pluginVersion(place.dir)).toBe(version)
    expect(readFileSync(join(place.dir, 'skills', 'deploy', 'SKILL.md'), 'utf8')).toBe('# deploy')
  })

  it('drops a skill no longer chosen', () => {
    const { roots, market } = folders()
    wrapSkills(market, chosenSkills(market, roots, ['review', 'deploy']))
    wrapSkills(market, chosenSkills(market, roots, ['review']))
    expect(wrappedSkills(market)).toEqual(['review'])
  })
})

describe('rewrapSkills', () => {
  it('takes an edit of a chosen skill into a new version', () => {
    const { roots, claude, market } = folders()
    const before = wrapSkills(market, chosenSkills(market, roots, ['review']))
    writeFileSync(join(claude, 'review', 'SKILL.md'), '# review, edited')
    rewrapSkills(market, roots)
    expect(pluginVersion(join(market, 'plugin'))).not.toBe(before)
    expect(readFileSync(join(market, 'plugin', 'skills', 'review', 'SKILL.md'), 'utf8')).toBe('# review, edited')
  })

  it('keeps the copy of a skill whose folder is gone', () => {
    const { roots, claude, market } = folders()
    const before = wrapSkills(market, chosenSkills(market, roots, ['review', 'notes']))
    rmSync(join(claude, 'review'), { recursive: true })
    rewrapSkills(market, roots.slice(0, 1))
    expect(wrappedSkills(market).sort()).toEqual(['notes', 'review'])
    expect(pluginVersion(join(market, 'plugin'))).toBe(before)
  })
})

describe('chosenSkills', () => {
  it('leaves out a name neither the folders nor the plugin hold', () => {
    const { roots, market } = folders()
    expect(chosenSkills(market, roots, ['review', 'missing']).map((each) => each.name)).toEqual(['review'])
  })
})
