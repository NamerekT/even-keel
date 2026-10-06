import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { samePath } from '../paths.js'
import { projectDirName } from '../sessions/paths.js'
import { readMcpSources } from '../tracker/mcp.js'
import type { ToolsView } from './model.js'
import { readReceived, skillSource } from './received.js'
import { accountDrift, mcpRows, settingRows, trimSettings } from './settings.js'

type Json = Record<string, unknown>

/** Tool attachments come in the first lines; MCP servers connect a little after the first answer. */
const HEAD_LINES = 400
const WORKTREE_DIR = '--claude-worktrees-'

export interface ToolsPlaces {
  repo: string
  globalDir: string
  /** `.claude.json` files whose MCP servers and project entries sessions read. */
  configs: string[]
  /** Account folders other than the global one. */
  accounts: { key: string; dir: string }[]
  /** Every config folder: transcripts are looked for in all of them. */
  homes: string[]
  trim: boolean
  hidden: string[]
  /** `--permission-mode` of chain sessions. */
  mode: string
}

/** The `--settings` JSON for a chain session of the repository, `undefined` with trimming off. */
export function chainSettings(repo: string, trim: boolean, hidden: string[]): string | undefined {
  if (!trim) return undefined
  const { project, local } = projectSettings(repo)
  return JSON.stringify(trimSettings(hidden, project, local))
}

export async function readToolsView(project: string, places: ToolsPlaces): Promise<ToolsView> {
  const { repo } = places
  const user = readJson(join(places.globalDir, 'settings.json'))
  const { project: shared, local } = projectSettings(repo)
  const chain = places.trim ? trimSettings(places.hidden, shared, local) : undefined
  const sources = readMcpSources(repo, { claudeDir: places.globalDir, configs: places.configs })
  const localAllowed = (sources?.configs ?? []).flatMap((config) => {
    const entries = Object.entries(objectOf(config.projects)).filter(([path]) => samePath(path, repo))
    return entries.flatMap(([, entry]) => strings(objectOf(entry).allowedTools))
  })

  const accounts = places.accounts
    .map(({ key, dir }) => ({ account: key, keys: accountDrift(user ?? {}, readJson(join(dir, 'settings.json')) ?? {}) }))
    .filter((drift) => drift.keys.length > 0)

  const received = await readNewest(places.homes, repo)
  const known = { user: new Set(dirNames(join(places.globalDir, 'skills'))), project: new Set(dirNames(join(repo, '.claude', 'skills'))) }

  return {
    project,
    repo,
    trim: places.trim,
    settings: settingRows({ user, project: shared, local, chain, chainMode: places.mode, localAllowed: [...new Set(localAllowed)] }),
    mcp: sources === undefined ? [] : mcpRows(sources, repo),
    accounts,
    received: received === undefined ? null : { ...received, skills: received.skills.map((name) => ({ name, source: skillSource(name, known) })) },
  }
}

function projectSettings(repo: string): { project: Json | undefined; local: Json | undefined } {
  return { project: readJson(join(repo, '.claude', 'settings.json')), local: readJson(join(repo, '.claude', 'settings.local.json')) }
}

/** The newest transcript of the project, a worktree one first: chain sessions run there. */
async function readNewest(homes: string[], repo: string) {
  const base = projectDirName(repo).toLowerCase()
  const found: { file: string; worktree: boolean; at: number }[] = []
  for (const home of homes) {
    const projects = join(home, 'projects')
    for (const dir of dirNames(projects)) {
      const name = dir.toLowerCase()
      const worktree = name.startsWith(base + WORKTREE_DIR)
      if (name !== base && !worktree) continue
      for (const file of fileNames(join(projects, dir)).filter((each) => each.endsWith('.jsonl'))) {
        const path = join(projects, dir, file)
        found.push({ file: path, worktree, at: mtime(path) })
      }
    }
  }
  found.sort((a, b) => Number(b.worktree) - Number(a.worktree) || b.at - a.at)
  for (const { file } of found.slice(0, 5)) {
    const received = readReceived(await headLines(file, HEAD_LINES))
    if (received !== undefined) return received
  }
  return undefined
}

async function headLines(file: string, count: number): Promise<string[]> {
  const lines: string[] = []
  const stream = createReadStream(file, { encoding: 'utf8' })
  const reader = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of reader) {
      lines.push(line)
      if (lines.length >= count) break
    }
  } finally {
    reader.close()
    stream.destroy()
  }
  return lines
}

function readJson(file: string): Json | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
  } catch {
    return undefined
  }
}

function dirNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function fileNames(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function mtime(file: string): number {
  try {
    return statSync(file).mtimeMs
  } catch {
    return 0
  }
}

function objectOf(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {}
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string') : []
}
