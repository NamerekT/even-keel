import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fail } from '../notice/notice.js'
import type { PackagesView } from '../state.js'
import { pluginDir } from './launch.js'
import type { PackagesFile } from './model.js'
import { pluginVersion } from './plugins.js'
import { chosenSkills, listSkills, rewrapSkills, skillFilesOf, SKILLS_PACKAGE, wrappedSkills, wrapSkills, type SkillRoot, type SkillsCopy } from './skills.js'

/** Where the user's skills are and where they are wrapped (BTN-339). */
export interface SkillsPlace {
  /** `state/skills`: the marketplace of the user's own skills, wrapped into one plugin. */
  skillsDir: string
  skillRoots: () => SkillRoot[]
  log: (line: string) => void
  /**
   * A machine elsewhere asks the hub for the skills of the hub's install (BTN-1565): `null` — the hub holds none of it,
   * `undefined` — the hub is not reachable. Its `state/skills/` is the hub's then, never wrapped again from its own folders.
   */
  skillsFromHub?: (install: string) => Promise<SkillsCopy | null | undefined>
}

/** The skills of this host's install `install` of the skills package, for a machine elsewhere (BTN-1565); `null` — none here. */
export function installedSkills(cache: string, install: string): SkillsCopy | null {
  if (!/^[a-z0-9]+$/i.test(install)) return null
  const dir = pluginDir(cache, SKILLS_PACKAGE, install)
  if (!existsSync(join(dir, 'skills'))) return null
  return { version: pluginVersion(dir), files: skillFilesOf(dir) }
}

/** The catalog has the package of the user's skills. */
export function wrapsSkills(file: PackagesFile): boolean {
  const record = file.packages[SKILLS_PACKAGE]
  return record !== undefined && record.removed !== true
}

export function ownSkills(file: PackagesFile, place: SkillsPlace): PackagesView['skills']['list'] {
  const wrapped = new Set(wrapsSkills(file) ? wrappedSkills(place.skillsDir) : [])
  const found = listSkills(place.skillRoots())
  const gone = [...wrapped].filter((name) => !found.some((skill) => skill.name === name)).map((name) => ({ name, from: null, wrapped: true }))
  return [...found.map(({ name, from }) => ({ name, from, wrapped: wrapped.has(name) })), ...gone]
}

/** The wrapped skills from their folders again; a failure leaves the last copy and is logged. */
export function rewrap(place: SkillsPlace): void {
  if (place.skillsFromHub !== undefined) return
  try {
    rewrapSkills(place.skillsDir, place.skillRoots())
  } catch (error) {
    place.log(`packages: the skills of ${SKILLS_PACKAGE} not copied again: ${(error as Error).message}`)
  }
}

/** The chosen skills copied into the plugin `my-skills` of `state/skills/`; the package itself is `Packages.wrapSkills`'. */
export function wrapChosen(place: SkillsPlace, names: string[]): void {
  const unique = [...new Set(names)]
  if (unique.length === 0) throw fail('packages.noSkills', {})
  const chosen = chosenSkills(place.skillsDir, place.skillRoots(), unique)
  const missing = unique.find((name) => !chosen.some((skill) => skill.name === name))
  if (missing !== undefined) throw fail('packages.unknownSkill', { name: missing })
  try {
    wrapSkills(place.skillsDir, chosen)
  } catch (error) {
    throw fail('packages.copyFailed', { name: SKILLS_PACKAGE }, { detail: (error as Error).message }, { cause: error })
  }
  place.log(`packages: ${SKILLS_PACKAGE} wraps ${unique.join(', ')}`)
}
