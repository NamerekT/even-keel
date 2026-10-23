import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { CLAUDE } from '../claude/name.js'
import { pluginKey } from './model.js'

/** The marketplace Even Keel writes the user's own skills into (BTN-339); it lives in `state/skills/`. */
export const SKILLS_MARKETPLACE = 'even-keel-skills'
export const SKILLS_PLUGIN = 'my-skills'
export const SKILLS_PACKAGE = pluginKey(SKILLS_PLUGIN, SKILLS_MARKETPLACE)

/** Not a skill: the account folders' own `synced` (`share.ts`); a dot folder (`.trash`, Codex's `.system`) neither. */
const NOT_SKILLS = new Set(['synced'])

/** A folder of the user's skills, one skill per subfolder with its `SKILL.md`; `from` — the agent it belongs to. */
export interface SkillRoot {
  dir: string
  from: string
}

export interface OwnSkill {
  name: string
  dir: string
  from: string
}

/** The skills of the folders; a name met again in a later folder is the first one's. */
export function listSkills(roots: readonly SkillRoot[]): OwnSkill[] {
  const found = new Map<string, OwnSkill>()
  for (const { dir, from } of roots) {
    for (const name of entries(dir)) {
      if (name.startsWith('.') || NOT_SKILLS.has(name) || found.has(name)) continue
      if (existsSync(join(dir, name, 'SKILL.md'))) found.set(name, { name, dir: join(dir, name), from })
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function pluginOf(marketDir: string): string {
  return join(marketDir, 'plugin')
}

/** The skills the plugin holds now, by name. */
export function wrappedSkills(marketDir: string): string[] {
  return entries(join(pluginOf(marketDir), 'skills')).filter((name) => existsSync(join(pluginOf(marketDir), 'skills', name, 'SKILL.md')))
}

/**
 * The version of a set of skill folders: `1.0.0+<hash>` of every file's path and bytes, so an edit of a skill makes a
 * new version and the package's Update installs it. The build part leaves the order to `skillsChanged`.
 */
export function skillsVersion(skills: readonly { name: string; dir: string }[]): string {
  const hash = createHash('sha256')
  for (const { name, dir } of [...skills].sort((a, b) => a.name.localeCompare(b.name))) {
    for (const file of filesOf(dir)) {
      hash.update(`${name}/${relative(dir, file).replaceAll('\\', '/')}\u0000`)
      hash.update(readFileSync(file))
      hash.update('\u0000')
    }
  }
  return `1.0.0+${hash.digest('hex').slice(0, 8)}`
}

/** Whether the marketplace offers another version than the install: a hash has no order. */
export function skillsChanged(offered: string | null, installed: string | null): boolean {
  return offered !== null && offered !== installed
}

/**
 * Writes the marketplace with one plugin of the skills: `.claude-plugin/marketplace.json` and
 * `plugin/{.claude-plugin/plugin.json, skills/<name>}`, the folders copied with their links followed. Nothing is
 * written when the version is the same. The plugin is built next to the old one and swapped in.
 */
export function wrapSkills(marketDir: string, skills: readonly { name: string; dir: string }[]): string {
  const version = skillsVersion(skills)
  const plugin = pluginOf(marketDir)
  if (readVersion(plugin) === version && sameNames(wrappedSkills(marketDir), skills)) return version
  const next = `${plugin}.next`
  rmSync(next, { recursive: true, force: true })
  for (const { name, dir } of skills) cpSync(dir, join(next, 'skills', name), { recursive: true, dereference: true })
  writeJson(join(next, '.claude-plugin', 'plugin.json'), {
    name: SKILLS_PLUGIN,
    version,
    description: "The user's own skills, wrapped by Even Keel for every agent",
    author: { name: 'Even Keel' },
  })
  writeJson(join(marketDir, '.claude-plugin', 'marketplace.json'), {
    name: SKILLS_MARKETPLACE,
    description: "The user's own skills as one plugin, written by Even Keel",
    owner: { name: 'Even Keel' },
    plugins: [{ name: SKILLS_PLUGIN, source: './plugin' }],
  })
  rmSync(plugin, { recursive: true, force: true })
  renameSync(next, plugin)
  return version
}

/** The plugin's skills from their folders again; a skill whose folder is gone keeps its copy. */
export function rewrapSkills(marketDir: string, roots: readonly SkillRoot[]): void {
  const names = wrappedSkills(marketDir)
  if (names.length === 0) return
  wrapSkills(marketDir, chosenSkills(marketDir, roots, names))
}

/** The folders of the chosen skills: the user's, else the plugin's own copy; a name neither has is left out. */
export function chosenSkills(marketDir: string, roots: readonly SkillRoot[], names: readonly string[]): { name: string; dir: string }[] {
  const own = new Map(listSkills(roots).map((skill) => [skill.name, skill.dir]))
  const kept = new Set(wrappedSkills(marketDir))
  return names.flatMap((name) => {
    const dir = own.get(name) ?? (kept.has(name) ? join(pluginOf(marketDir), 'skills', name) : undefined)
    return dir === undefined ? [] : [{ name, dir }]
  })
}

/** Claude Code reads the user's skills from its account folder: the plugin would give them twice. */
export function readsOwnSkills(agent: string): boolean {
  return agent === CLAUDE
}

function sameNames(wrapped: string[], skills: readonly { name: string }[]): boolean {
  return JSON.stringify([...wrapped].sort()) === JSON.stringify(skills.map((skill) => skill.name).sort())
}

function readVersion(plugin: string): string | undefined {
  try {
    const version: unknown = JSON.parse(readFileSync(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8')).version
    return typeof version === 'string' ? version : undefined
  } catch {
    return undefined
  }
}

function filesOf(dir: string): string[] {
  return entries(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? filesOf(path) : [path]
    })
}

function entries(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}
