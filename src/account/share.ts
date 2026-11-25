import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmdirSync,
  type Stats,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { cloudOf, isCloudVariable } from './cloud.js'
import { pathKey, samePath, sameSpelling } from '../paths.js'
import { projectDirName } from '../sessions/paths.js'
import { listenOf, localUrlOf } from '../config.js'
import { stripSettingsGuard, withSettingsGuard } from './settingsGuard.js'

type Json = Record<string, unknown>

const PROJECT_KEYS = [
  'hasTrustDialogAccepted',
  'mcpServers',
  'allowedTools',
  'enabledMcpjsonServers',
  'disabledMcpjsonServers',
  'disabledMcpServers',
  'mcpContextUris',
  'hasClaudeMdExternalIncludesApproved',
  'hasClaudeMdExternalIncludesWarningShown',
]
const ONBOARDING_KEYS = ['hasCompletedOnboarding', 'lastOnboardingVersion']
const LINKED_DIRS = ['agents', 'commands', 'hooks', 'output-styles']
const OWN_SKILLS = new Set(['synced', '.trash'])
export const API_KEY_VARIABLE = 'ANTHROPIC_API_KEY'
/** The long-lived token of `claude setup-token` (BTN-1005): it makes a long-token account, never shared between folders. */
export const OAUTH_TOKEN_VARIABLE = 'CLAUDE_CODE_OAUTH_TOKEN'
const COPIED_FILES = ['CLAUDE.md', join('plugins', 'installed_plugins.json'), join('plugins', 'known_marketplaces.json')]

export interface SharedSources {
  dir: string
  config: string
}

/**
 * The global settings win, except the folder's own API key, long token and cloud connection: they are what makes an API,
 * a long-token or a cloud account (`docs/accounts.md`). A cloud folder takes none of the cloud's variables from the global
 * settings, and no folder takes the global long token.
 */
export function mergeSettings(global: Json, folder: Json | undefined): Json {
  const merged = { ...folder, ...global }
  const own = objectOf(folder?.env)
  const globalEnv = Object.fromEntries(Object.entries(objectOf(global.env)).filter(([name]) => name !== OAUTH_TOKEN_VARIABLE))
  if (OAUTH_TOKEN_VARIABLE in objectOf(global.env)) merged.env = globalEnv
  const key = own[API_KEY_VARIABLE]
  if (typeof key === 'string') merged.env = { ...globalEnv, [API_KEY_VARIABLE]: key }
  const token = own[OAUTH_TOKEN_VARIABLE]
  if (typeof token === 'string') merged.env = { ...globalEnv, [OAUTH_TOKEN_VARIABLE]: token }
  if (cloudOf(own) !== null) {
    const shared = Object.fromEntries(Object.entries(objectOf(merged.env ?? global.env)).filter(([name]) => !isCloudVariable(name)))
    const cloud = Object.fromEntries(Object.entries(own).filter(([name]) => isCloudVariable(name)))
    merged.env = { ...shared, ...cloud }
  }
  if (folder?.apiKeyHelper !== undefined) merged.apiKeyHelper = folder.apiKeyHelper
  return merged
}

/**
 * Project memory lives next to the global folder, not inside it: the global folder and every account folder hold only
 * a link to it. The CLI asks before every write whose real path lies in a `.claude` folder that is not the session's own.
 */
export function memoryStore(globalDir: string): string {
  return join(dirname(globalDir), '.claude-memory')
}

/**
 * The user's global configuration next to the global folder, for the same reason as memory: skills, `agents`,
 * `commands`, `hooks`, `output-styles`, and copies of `CLAUDE.md` and `settings.json`. It is one repository synced
 * between the machines of the network (BTN-1690).
 */
export function configStore(globalDir: string): string {
  return join(dirname(globalDir), '.claude-config')
}

/** Shared skills: `~/.claude/skills/<name>` links to `<configStore>/skills/<name>`. */
export function skillStore(globalDir: string): string {
  return linkedStore(globalDir, 'skills')
}

/** `agents`, `commands`, `hooks` and `output-styles` each live in their folder of the config store, as skills do. */
export function linkedStore(globalDir: string, name: string): string {
  return join(configStore(globalDir), name)
}

/** Where a store lived before BTN-1690: `~/.claude-<name>`, `~/.claude-skills`; left as a link to the new place. */
function legacyStore(globalDir: string, name: string): string {
  return join(dirname(globalDir), `.claude-${name}`)
}

/**
 * Moves the stores of before BTN-1690 into the config store and leaves each old place as a link to the new one; the
 * global folder's links to an old place are pointed at the new one, then its own folders and skills are absorbed into
 * the store. Account folders are re-linked by `shareConfig`. Gives whether anything changed.
 */
export function settleStores(globalDir: string, warn: (message: string) => void = console.warn): boolean {
  let changed = false
  for (const name of [...LINKED_DIRS, 'skills']) {
    const legacy = legacyStore(globalDir, name)
    const stored = linkedStore(globalDir, name)
    changed = moveStore(legacy, stored, warn, name) || changed
    if (name !== 'skills') {
      const own = join(globalDir, name)
      if (linksTo(own, legacy)) changed = relink(stored, own) || changed
      changed = absorbFolder(own, stored, warn, name) || changed
      continue
    }
    for (const skill of entries(join(globalDir, 'skills'))) {
      if (OWN_SKILLS.has(skill)) continue
      const own = join(globalDir, 'skills', skill)
      if (linksTo(own, join(legacy, skill))) changed = relink(join(stored, skill), own) || changed
      changed = absorbFolder(own, join(stored, skill), warn, 'skills') || changed
    }
  }
  return changed
}

/** A real folder at the old place goes into the new one (renamed, or merged file by file), then becomes a link to it. */
function moveStore(legacy: string, stored: string, warn: (message: string) => void, what: string): boolean {
  const stat = lstatOf(legacy)
  if (stat === undefined) return false
  if (stat.isSymbolicLink() || !stat.isDirectory()) return false
  try {
    mkdirSync(dirname(stored), { recursive: true })
    let changed = false
    if (!existsSync(stored)) renameSync(legacy, stored)
    else {
      changed = moveInto(legacy, stored, warn, what)
      if (readdirSync(legacy).length > 0) return changed
      rmdirSync(legacy)
    }
    symlinkSync(stored, legacy, linkType(process.platform))
    return true
  } catch (error) {
    warn(`${what}: ${legacy} was not moved to ${stored} (${error instanceof Error ? error.message : String(error)}); left in place`)
    return false
  }
}

/** Points an existing link at `target`. */
function relink(target: string, path: string): boolean {
  if (!isDirectory(target)) return false
  unlinkSync(path)
  symlinkSync(target, path, linkType(process.platform))
  return true
}

/** The repository's folder in the memory store; chain sessions also get it as `autoMemoryDirectory`. */
export function sharedMemory(globalDir: string, repo: string): string {
  return join(memoryStore(globalDir), projectDirName(repo))
}

export function linkType(platform: NodeJS.Platform): 'junction' | 'dir' {
  return platform === 'win32' ? 'junction' : 'dir'
}

export function shareProjects(global: Json, folder: Json, platform: NodeJS.Platform = process.platform): Json | undefined {
  const projects: Json = { ...objectOf(folder.projects) }
  const globalProjects = Object.entries(objectOf(global.projects))
  const keyOf = (path: string) => pathKey(path, platform)
  const trusted = new Set(globalProjects.filter(([, value]) => objectOf(value).hasTrustDialogAccepted === true).map(([path]) => keyOf(path)))
  for (const [path, value] of globalProjects) {
    const project = objectOf(value)
    if (!trusted.has(keyOf(path))) continue
    const setup = Object.fromEntries(PROJECT_KEYS.filter((key) => key in project).map((key) => [key, project[key]]))
    projects[path] = { ...objectOf(projects[path]), ...setup }
  }
  const shared: Json = { ...folder, projects }
  if (global.mcpServers !== undefined) shared.mcpServers = global.mcpServers
  for (const key of ONBOARDING_KEYS) if (shared[key] === undefined && global[key] !== undefined) shared[key] = global[key]
  return JSON.stringify(shared) === JSON.stringify(folder) ? undefined : shared
}

/** What goes into the folder's `settings.json`, from the global one and the folder's own (`planSettings`, BTN-901). */
export type SettingsPlanner = (global: Json, folder: Json | undefined) => Json

export function shareConfig(global: SharedSources, dir: string, warn: (message: string) => void = console.warn, planner: SettingsPlanner = mergeSettings): boolean {
  mkdirSync(dir, { recursive: true })
  let changed = false
  const settings = readJson(join(global.dir, 'settings.json'))
  const folderFile = join(dir, 'settings.json')
  const folder = readJson(folderFile)
  if (!samePath(dir, global.dir) && (folder !== undefined || !existsSync(folderFile))) {
    const merged = planner(stripSettingsGuard(settings ?? {}), folder === undefined ? undefined : stripSettingsGuard(folder))
    const guarded = withSettingsGuard(merged, { accountsDir: dirname(dir), globalDir: global.dir, url: localUrlOf(listenOf(process.env)) })
    changed = writeIfChanged(folderFile, guarded) || changed
  }

  const config = readJson(global.config)
  if (config !== undefined) {
    const shared = shareProjects(config, readJson(join(dir, '.claude.json')) ?? {})
    if (shared !== undefined) {
      writeFileSync(join(dir, '.claude.json'), JSON.stringify(shared, null, 2))
      changed = true
    }
  }

  for (const file of COPIED_FILES) changed = copyIfChanged(join(global.dir, file), join(dir, file)) || changed
  changed = settleStores(global.dir, warn) || changed
  for (const name of LINKED_DIRS) {
    const own = join(global.dir, name)
    const stored = linkedStore(global.dir, name)
    changed = link(linksTo(own, stored) ? stored : own, join(dir, name)) || changed
  }
  const skills = skillStore(global.dir)
  const legacySkills = legacyStore(global.dir, 'skills')
  for (const name of entries(join(global.dir, 'skills'))) {
    if (OWN_SKILLS.has(name)) continue
    const own = join(global.dir, 'skills', name)
    const stored = join(skills, name)
    const path = join(dir, 'skills', name)
    const target = linksTo(own, stored) ? stored : own
    if (!linksElsewhere(path, [own, stored, join(legacySkills, name)])) changed = link(target, path) || changed
  }
  const store = memoryStore(global.dir)
  const projects = new Set([...entries(join(global.dir, 'projects')), ...entries(join(dir, 'projects'))])
  for (const project of projects) {
    const shared = join(store, project)
    const owns = [global.dir, dir].map((home) => join(home, 'projects', project, 'memory'))
    for (const own of owns) changed = absorbMemory(shared, own, warn) || changed
    for (const own of owns) changed = link(shared, own) || changed
  }
  return changed
}

/** Moves what a folder's own memory holds into the store; files that differ stay and are warned about. */
function absorbMemory(shared: string, own: string, warn: (message: string) => void): boolean {
  if (!existsSync(own)) return false
  const stat = lstatSync(own)
  if (stat.isSymbolicLink() || !stat.isDirectory()) return false
  mkdirSync(shared, { recursive: true })
  return moveInto(own, shared, warn, 'memory')
}

/**
 * Moves a global skill or linked folder kept as a real folder into the store and leaves a link in its place; one already linked
 * (to the store or elsewhere) stays, a missing one is linked to the store if it has it. A folder the store already has
 * is merged as memory is; a locked one waits for the next launch.
 */
function absorbFolder(own: string, stored: string, warn: (message: string) => void, what: string): boolean {
  const stat = lstatOf(own)
  if (stat === undefined) return link(stored, own)
  if (stat.isSymbolicLink() || !stat.isDirectory()) return false
  try {
    if (!existsSync(stored)) {
      mkdirSync(dirname(stored), { recursive: true })
      renameSync(own, stored)
      symlinkSync(stored, own, linkType(process.platform))
      return true
    }
    const moved = moveInto(own, stored, warn, what)
    return link(stored, own) || moved
  } catch (error) {
    warn(`${what}: ${own} was not moved to ${stored} (${error instanceof Error ? error.message : String(error)}); left in place`)
    return false
  }
}

function moveInto(from: string, to: string, warn: (message: string) => void, what: string): boolean {
  let changed = false
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) {
      mkdirSync(target, { recursive: true })
      changed = moveInto(source, target, warn, what) || changed
      if (readdirSync(source).length === 0) rmdirSync(source)
    } else if (!existsSync(target)) {
      copyFileSync(source, target)
      unlinkSync(source)
      changed = true
    } else if (readFileSync(source).equals(readFileSync(target))) {
      unlinkSync(source)
      changed = true
    } else {
      warn(`${what}: ${source} differs from ${target}; left in place, merge by hand`)
    }
  }
  return changed
}

function link(target: string, path: string): boolean {
  if (!isDirectory(target)) return false
  const stat = lstatOf(path)
  if (stat?.isSymbolicLink()) {
    if (sameSpelling(linkTarget(path), target)) return false
    unlinkSync(path)
  } else if (stat !== undefined) {
    if (!stat.isDirectory() || readdirSync(path).length > 0) return false
    rmdirSync(path)
  }
  mkdirSync(join(path, '..'), { recursive: true })
  symlinkSync(target, path, linkType(process.platform))
  return true
}

function copyIfChanged(from: string, to: string): boolean {
  let source: Buffer
  try {
    source = readFileSync(from)
  } catch {
    return false
  }
  try {
    if (readFileSync(to).equals(source)) return false
  } catch {
    mkdirSync(join(to, '..'), { recursive: true })
  }
  copyFileSync(from, to)
  return true
}

function writeIfChanged(file: string, value: Json): boolean {
  if (JSON.stringify(readJson(file)) === JSON.stringify(value)) return false
  writeFileSync(file, JSON.stringify(value, null, 2))
  return true
}

function readJson(file: string): Json | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
  } catch {
    return undefined
  }
}

function entries(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function lstatOf(path: string): Stats | undefined {
  try {
    return lstatSync(path)
  } catch {
    return undefined
  }
}

function linksTo(path: string, target: string): boolean {
  return lstatOf(path)?.isSymbolicLink() === true && sameSpelling(linkTarget(path), target)
}

/** A live link to a folder other than the given ones: a skill the user pointed somewhere on purpose. */
function linksElsewhere(path: string, targets: string[]): boolean {
  if (lstatOf(path)?.isSymbolicLink() !== true || !existsSync(path)) return false
  return !targets.some((target) => sameSpelling(linkTarget(path), target))
}

/** A junction's target comes back as `\\?\C:\…\` on Windows. */
function linkTarget(path: string): string {
  return readlinkSync(path)
    .replace(/^\\\\\?\\/, '')
    .replace(/[\\/]+$/, '')
}

function isDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

function objectOf(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {}
}
