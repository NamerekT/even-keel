import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { sameSpelling } from '../paths.js'
import { linkType, OWN_SKILLS, skillStore } from './share.js'

/** The skills folder Codex, Copilot and OpenCode read in the home folder, next to the global `~/.claude`. */
export function agentSkillsDir(globalDir: string): string {
  return join(dirname(globalDir), '.agents', 'skills')
}

/**
 * Gives Codex, Copilot and OpenCode the user's own skills (BTN-1691, `docs/packages/files.md`): `~/.agents/skills/<name>`
 * links to the skill store's `<name>`, one link a skill, as account folders link theirs for Claude. A real folder there
 * and a link elsewhere are the user's and stay; a link into the store whose skill is gone is removed. Gives whether
 * anything changed.
 */
export function linkAgentSkills(globalDir: string, log: (line: string) => void): boolean {
  const store = resolve(skillStore(globalDir))
  const agents = resolve(agentSkillsDir(globalDir))
  const linked: string[] = []
  const removed: string[] = []
  for (const name of folders(store)) {
    const path = join(agents, name)
    const target = join(store, name)
    if (lstatOf(path) !== undefined) continue
    try {
      mkdirSync(agents, { recursive: true })
      symlinkSync(target, path, linkType(process.platform))
      linked.push(name)
    } catch (error) {
      log(`skills: ${path} was not linked to ${target}: ${(error as Error).message}`)
    }
  }
  for (const name of folders(agents)) {
    const path = join(agents, name)
    if (lstatOf(path)?.isSymbolicLink() !== true || existsSync(path)) continue
    if (!sameSpelling(dirname(targetOf(path)), store)) continue
    unlinkSync(path)
    removed.push(name)
  }
  if (linked.length === 0 && removed.length === 0) return false
  const parts = [linked.length > 0 && `linked ${linked.join(', ')}`, removed.length > 0 && `removed ${removed.join(', ')}, gone from the store`]
  log(`skills: ${agents}: ${parts.filter(Boolean).join('; ')}`)
  return true
}

function folders(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !OWN_SKILLS.has(entry.name) && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function lstatOf(path: string) {
  try {
    return lstatSync(path)
  } catch {
    return undefined
  }
}

/** A junction's target comes back as `\\?\C:\…\` on Windows. */
function targetOf(path: string): string {
  return readlinkSync(path).replace(/^\\\\\?\\/, '').replace(/[\\/]+$/, '')
}
