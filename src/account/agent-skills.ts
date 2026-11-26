import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { sameSpelling } from '../paths.js'
import { configStore, linkType, OWN_SKILLS, skillStore } from './share.js'

/** The skills folder Codex, Copilot and OpenCode read in the home folder, next to the global `~/.claude`. */
export function agentSkillsDir(globalDir: string): string {
  return join(dirname(globalDir), '.agents', 'skills')
}

/**
 * The names of the store's skills `~/.claude/skills` linked to at the last pass, one a line: what tells a skill the user
 * deleted there from one a sync brought. It lives in the store's `.git`, so it is this working copy's and never synced.
 */
function recordOf(globalDir: string): string | undefined {
  const git = join(configStore(globalDir), '.git')
  return existsSync(git) ? join(git, 'even-keel-skills') : undefined
}

/**
 * Lays the user's own skills out of the skill store (BTN-1691, BTN-1736, `docs/packages/files.md`): `~/.claude/skills/<name>`
 * for Claude Code and `~/.agents/skills/<name>` for Codex, Copilot and OpenCode link to the store's `<name>`, one link a
 * skill. A skill whose `~/.claude/skills` link was there at the last pass and is gone now was deleted by the user: it
 * leaves the store, and so every link to it. A real folder and a link elsewhere are the user's and stay; a link into the
 * store whose skill is gone is removed. Gives whether anything changed.
 */
export function linkAgentSkills(globalDir: string, log: (line: string) => void): boolean {
  const store = resolve(skillStore(globalDir))
  const claude = resolve(join(globalDir, 'skills'))
  const record = recordOf(globalDir)
  const deleted = existsSync(claude) ? deleteUnlinked(store, claude, readRecord(record), log) : false
  const linked = linkInto(claude, store, log)
  const shared = linkInto(resolve(agentSkillsDir(globalDir)), store, log)
  if (record !== undefined) writeRecord(record, folders(claude).filter((name) => linksInto(join(claude, name), store) && existsSync(join(claude, name))))
  return deleted || linked || shared
}

function deleteUnlinked(store: string, claude: string, known: Set<string>, log: (line: string) => void): boolean {
  const deleted: string[] = []
  for (const name of folders(store)) {
    if (!known.has(name) || lstatOf(join(claude, name)) !== undefined) continue
    try {
      rmSync(join(store, name), { recursive: true, force: true })
      deleted.push(name)
    } catch (error) {
      log(`skills: ${join(store, name)} was not deleted: ${(error as Error).message}`)
    }
  }
  if (deleted.length === 0) return false
  log(`skills: deleted ${deleted.join(', ')} from the store, gone from ${claude}`)
  return true
}

/** One link a skill of the store in `dir`; a link of `dir` into the store whose skill is gone goes. */
function linkInto(dir: string, store: string, log: (line: string) => void): boolean {
  const linked: string[] = []
  const removed: string[] = []
  for (const name of folders(store)) {
    const path = join(dir, name)
    const target = join(store, name)
    if (lstatOf(path) !== undefined) continue
    try {
      mkdirSync(dir, { recursive: true })
      symlinkSync(target, path, linkType(process.platform))
      linked.push(name)
    } catch (error) {
      log(`skills: ${path} was not linked to ${target}: ${(error as Error).message}`)
    }
  }
  for (const name of folders(dir)) {
    const path = join(dir, name)
    if (existsSync(path) || !linksInto(path, store)) continue
    unlinkSync(path)
    removed.push(name)
  }
  if (linked.length === 0 && removed.length === 0) return false
  const parts = [linked.length > 0 && `linked ${linked.join(', ')}`, removed.length > 0 && `removed ${removed.join(', ')}, gone from the store`]
  log(`skills: ${dir}: ${parts.filter(Boolean).join('; ')}`)
  return true
}

function linksInto(path: string, store: string): boolean {
  return lstatOf(path)?.isSymbolicLink() === true && sameSpelling(dirname(targetOf(path)), store)
}

function readRecord(record: string | undefined): Set<string> {
  if (record === undefined) return new Set()
  try {
    return new Set(readFileSync(record, 'utf8').split('\n').filter(Boolean))
  } catch {
    return new Set()
  }
}

function writeRecord(record: string, names: string[]): void {
  const text = names.map((name) => `${name}\n`).join('')
  try {
    if (readFileSync(record, 'utf8') === text) return
  } catch {
    // no record yet
  }
  writeFileSync(record, text)
}

function folders(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !OWN_SKILLS.has(entry.name) && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort()
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
