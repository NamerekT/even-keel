import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

/** Every bundled plugin skill: an unparsable frontmatter makes Claude Code load the skill with empty metadata, so sessions never see it. */
const plugins = join(import.meta.dirname, '..', '..', 'plugins')
const skills = readdirSync(plugins, { withFileTypes: true })
  .filter((plugin) => plugin.isDirectory())
  .flatMap((plugin) => {
    const root = join(plugins, plugin.name, 'skills')
    try {
      return readdirSync(root, { withFileTypes: true }).filter((each) => each.isDirectory()).map((each) => `${plugin.name}/skills/${each.name}`)
    } catch {
      return []
    }
  })

describe('plugin skill frontmatter', () => {
  it('finds the bundled skills', () => {
    expect(skills.length).toBeGreaterThan(0)
  })

  it.each(skills)('%s parses as YAML with a name and a description', (skill) => {
    const text = readFileSync(join(plugins, skill, 'SKILL.md'), 'utf8')
    const block = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)
    expect(block, 'no frontmatter block').not.toBeNull()
    const data: unknown = parse(block?.[1] ?? '')
    expect(data).toMatchObject({ name: expect.stringMatching(/\S/), description: expect.stringMatching(/\S/) })
  })
})
