import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { sharedMemory } from '../account/share.js'
import { INSTRUCTION_FILES, repoRulesOf, SKILL_FOLDERS, type RepoRules } from '../agent/projectRules.js'
import { CLAUDE } from '../claude/name.js'
import type { Git } from '../git/types.js'
import type { SessionReach } from '../packages/model.js'
import { samePath } from '../paths.js'
import type { CacheTtl } from '../state.js'
import { protectionRules, type Protection } from '../sessions/protection.js'
import { projectDirName } from '../sessions/paths.js'
import type { ReceivedTools, ToolsView } from './model.js'
import { latestStarted, readReceived, skillSource } from './received.js'
import { accountDrift, forPackageOff, settingRows, trimSettings } from './settings.js'

type Json = Record<string, unknown>

/** Tool attachments come in the first lines; MCP servers connect a little after the first answer. */
const HEAD_LINES = 400
const WORKTREE_DIR = '--claude-worktrees-'
/** How many of the last touched transcripts are compared by their start. */
const RECENT = 8

export interface ToolsPlaces {
  repo: string
  /** The project's branch, whose instruction files and skills its sessions get. */
  branch: string
  git: Git
  globalDir: string
  /** `.claude.json` files whose MCP servers and project entries sessions read. */
  configs: string[]
  /**
   * Account folders other than the global one; only Claude's a project runs on (`used`) are compared with the global
   * `settings.json`: the copy goes on top of an account's folder before its launch, so an idle one is merely stale.
   */
  accounts: { key: string; dir: string; agent: string; used: boolean }[]
  /** Every config folder: transcripts are looked for in all of them. */
  homes: string[]
  trim: boolean
  hidden: string[]
  /** `--permission-mode` of chain sessions. */
  mode: string
  /** What the project's packages bring: a local-only setting of any other plugin or server is left out. */
  reach: SessionReach
}

/**
 * The `--settings` JSON for a chain session of the repository: the shared memory folder, the enabled plugins its
 * packages do not bring turned off (`otherPlugins`), the prompt cache TTL when the config pins one, the `secrets`
 * blanked in `env` and, with trimming on, the trimming. The flag's `env` outranks the user's and the project's settings,
 * and an empty value hides a key one of them sets (checked on CLI 2.1.310, BTN-436).
 */
export function chainSettings(
  repo: string,
  plugins: Record<string, false>,
  trim: boolean,
  hidden: string[],
  globalDir: string,
  cacheTtl: CacheTtl | null,
  secrets: readonly string[] = [],
  protection?: Protection,
): string {
  const always = {
    permissions: { deny: protectionRules(protection).claude },
    autoMemoryDirectory: sharedMemory(globalDir, repo),
    ...(Object.keys(plugins).length > 0 && { enabledPlugins: plugins }),
    ...(cacheTtl !== null && { promptCacheTtl: cacheTtl }),
    ...(secrets.length > 0 && { env: Object.fromEntries(secrets.map((name) => [name, ''])) }),
  }
  if (!trim) return JSON.stringify(always)
  const { project, local } = projectSettings(repo)
  return JSON.stringify({ ...trimSettings(hidden, project, local), ...always })
}

export async function readToolsView(project: string, places: ToolsPlaces): Promise<ToolsView> {
  const { repo } = places
  const user = readJson(join(places.globalDir, 'settings.json'))
  const { project: shared, local } = projectSettings(repo)
  const chain = places.trim ? trimSettings(places.hidden, shared, local) : undefined
  const configs = places.configs.map(readJson).filter((config) => config !== undefined)
  const localAllowed = configs.flatMap((config) => {
    const entries = Object.entries(objectOf(config.projects)).filter(([path]) => samePath(path, repo))
    return entries.flatMap(([, entry]) => strings(objectOf(entry).allowedTools))
  })

  const accounts = places.accounts
    .filter(({ agent, used }) => agent === CLAUDE && used)
    .map(({ key, dir }) => ({ account: key, keys: accountDrift(user ?? {}, readJson(join(dir, 'settings.json')) ?? {}) }))
    .filter((drift) => drift.keys.length > 0)

  const [received, rules, docs] = await Promise.all([
    readNewest(places.homes, repo),
    readRepoRules(places.git, repo, places.branch),
    readBranchDocs(places.git, repo, places.branch),
  ])
  const known = { user: new Set(dirNames(join(places.globalDir, 'skills'))), project: new Set(dirNames(join(repo, '.claude', 'skills'))) }

  return {
    project,
    repo,
    trim: places.trim,
    settings: settingRows({ user, project: shared, local, chain, chainMode: places.mode, localAllowed: [...new Set(localAllowed)] }).filter(
      (row) => !forPackageOff(row, places.reach),
    ),
    accounts,
    received: received === undefined ? null : { ...received, skills: received.skills.map((name) => ({ name, source: skillSource(name, known) })) },
    rules,
    docs,
  }
}

/** The Markdown files committed on the branch, sorted. */
export async function readBranchDocs(git: Git, repo: string, branch: string): Promise<string[] | null> {
  // `ls-tree` takes no glob in its paths: the whole tree, filtered here.
  const result = await git(repo, ['ls-tree', '-r', '--name-only', branch])
  return result.code === 0 ? result.out.split('\n').map((line) => line.trim()).filter((line) => /\.md$/i.test(line)).sort() : null
}

/** What the branch a task worktree starts from holds: an uncommitted file never reaches a session. */
export async function readRepoRules(git: Git, repo: string, branch: string): Promise<RepoRules | null> {
  const result = await git(repo, ['ls-tree', '-r', '--name-only', branch, '--', ...INSTRUCTION_FILES, ...SKILL_FOLDERS])
  return result.code === 0 ? repoRulesOf(result.out.split('\n')) : null
}

function projectSettings(repo: string): { project: Json | undefined; local: Json | undefined } {
  return { project: readJson(join(repo, '.claude', 'settings.json')), local: readJson(join(repo, '.claude', 'settings.local.json')) }
}

/** The project's session that started last among the last touched transcripts, worktree ones first: chain sessions run there. */
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
  const received: ReceivedTools[] = []
  for (const { file } of found.slice(0, RECENT)) {
    const session = readReceived(await headLines(file, HEAD_LINES))
    if (session !== undefined) received.push(session)
  }
  return latestStarted(received)
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
