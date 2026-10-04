import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathKey } from '../paths.js'

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
const COPIED_FILES = ['CLAUDE.md', join('plugins', 'installed_plugins.json'), join('plugins', 'known_marketplaces.json')]

export interface SharedSources {
  dir: string
  config: string
}

export function mergeSettings(global: Json, folder: Json | undefined): Json {
  return { ...folder, ...global }
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

export function shareConfig(global: SharedSources, dir: string): boolean {
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
  for (const project of entries(join(global.dir, 'projects'))) {
    changed = link(join(global.dir, 'projects', project, 'memory'), join(dir, 'projects', project, 'memory')) || changed
  }
  return changed
}

function link(target: string, path: string): boolean {
  if (!isDirectory(target)) return false
  if (existsSync(path)) {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || !stat.isDirectory() || readdirSync(path).length > 0) return false
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
