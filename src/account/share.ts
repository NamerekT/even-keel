import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmdirSync,
  type Stats,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { pathKey, samePath } from '../paths.js'
import { projectDirName } from '../sessions/paths.js'

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
const COPIED_FILES = ['CLAUDE.md', join('plugins', 'installed_plugins.json'), join('plugins', 'known_marketplaces.json')]

export interface SharedSources {
  dir: string
  config: string
}

/** The global settings win, except the folder's own API key: it is what makes an API account (`docs/accounts.md`). */
export function mergeSettings(global: Json, folder: Json | undefined): Json {
  const merged = { ...folder, ...global }
  const key = objectOf(folder?.env)[API_KEY_VARIABLE]
  if (typeof key === 'string') merged.env = { ...objectOf(global.env), [API_KEY_VARIABLE]: key }
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

export function shareConfig(global: SharedSources, dir: string, warn: (message: string) => void = console.warn): boolean {
  mkdirSync(dir, { recursive: true })
  let changed = false
  const settings = readJson(join(global.dir, 'settings.json'))
  if (settings !== undefined) changed = writeIfChanged(join(dir, 'settings.json'), mergeSettings(settings, readJson(join(dir, 'settings.json')))) || changed

  const config = readJson(global.config)
  if (config !== undefined) {
    const shared = shareProjects(config, readJson(join(dir, '.claude.json')) ?? {})
    if (shared !== undefined) {
      writeFileSync(join(dir, '.claude.json'), JSON.stringify(shared, null, 2))
      changed = true
    }
  }

  for (const file of COPIED_FILES) changed = copyIfChanged(join(global.dir, file), join(dir, file)) || changed
  for (const name of LINKED_DIRS) changed = link(join(global.dir, name), join(dir, name)) || changed
  for (const name of entries(join(global.dir, 'skills'))) {
    if (!OWN_SKILLS.has(name)) changed = link(join(global.dir, 'skills', name), join(dir, 'skills', name)) || changed
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
  return moveInto(own, shared, warn)
}

function moveInto(from: string, to: string, warn: (message: string) => void): boolean {
  let changed = false
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) {
      mkdirSync(target, { recursive: true })
      changed = moveInto(source, target, warn) || changed
      if (readdirSync(source).length === 0) rmdirSync(source)
    } else if (!existsSync(target)) {
      copyFileSync(source, target)
      unlinkSync(source)
      changed = true
    } else if (readFileSync(source).equals(readFileSync(target))) {
      unlinkSync(source)
      changed = true
    } else {
      warn(`memory: ${source} differs from ${target}; left in place, merge by hand`)
    }
  }
  return changed
}

function link(target: string, path: string): boolean {
  if (!isDirectory(target)) return false
  const stat = lstatOf(path)
  if (stat?.isSymbolicLink()) {
    if (samePath(linkTarget(path), target)) return false
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
