import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AccountStatus } from '../account/model.js'
import { pathsOf, samePath } from '../paths.js'

/**
 * A Copilot account folder is a `COPILOT_HOME` (BTN-215, `docs/accounts.md`): the CLI keeps its config, its
 * `mcp-config.json` and the transcripts `session-state/<id>/events.jsonl` there. The sign-in is a GitHub token Even
 * Keel keeps in the folder's `even-keel.json` and hands to the CLI as `COPILOT_GITHUB_TOKEN`; the CLI's own sign-in
 * (`copilot login`) goes to the OS credential store, shared by every folder, so it is the account of a folder without
 * a token.
 */
const TOKEN_FILE = 'even-keel.json'
const CONFIG_FILE = 'config.json'

/** The variables the CLI takes a token from, in its order; each beats the stored sign-in. */
export const TOKEN_KEYS = ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'] as const

/**
 * What every Copilot command gets on top of the base: the account's folder and token, no self-update, and
 * `EVEN_KEEL_AGENT`, by which the checkpoint package's hooks answer in the shape Copilot takes (BTN-467).
 */
export function copilotEnv(base: NodeJS.ProcessEnv, dir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, COPILOT_HOME: dir, COPILOT_AUTO_UPDATE: 'false', EVEN_KEEL_AGENT: 'copilot' }
  for (const key of TOKEN_KEYS) delete env[key]
  const token = tokenOf(dir)
  if (token !== null) env.COPILOT_GITHUB_TOKEN = token
  return env
}

export function writeToken(dir: string, token: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, TOKEN_FILE), `${JSON.stringify({ githubToken: token }, null, 2)}\n`)
}

/** The folder's token; `null` — it runs on the CLI's own sign-in. */
export function tokenOf(dir: string): string | null {
  try {
    const value: unknown = JSON.parse(readFileSync(join(dir, TOKEN_FILE), 'utf8'))
    const token = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).githubToken : undefined
    return typeof token === 'string' && token !== '' ? token : null
  } catch {
    return null
  }
}

export function tokenFile(dir: string): string {
  return join(dir, TOKEN_FILE)
}

/**
 * A folder with a token is signed in by it, an account of a key like an API one (its token is checked and refused the
 * same way); one without runs on the CLI's own sign-in. Its source is probed separately for usage, while its status
 * counts as signed in with the method `none` and no identity.
 */
export function parseAuth(token: string | null): AccountStatus {
  return { loggedIn: true, authMethod: token === null ? 'none' : 'api_key', email: null, orgName: null, subscriptionType: null }
}

/**
 * Adds `folder` to `trustedFolders` of the account folder's `config.json`, the rest of the file kept (BTN-645).
 * Copilot runs the hooks of a repository's `.claude/settings.json` only in a trusted folder, its subfolders (the task
 * worktrees) included, and picking Copilot for a project is the consent. The project's `.mcp.json` the trust also
 * loads stays off by `--disable-mcp-server`. A file that is not a JSON object is refused rather than overwritten.
 */
export function trustFolder(dir: string, folder: string, platform: NodeJS.Platform = process.platform): void {
  const file = join(dir, CONFIG_FILE)
  let config: Record<string, unknown> = {}
  if (existsSync(file)) {
    const value = parseConfig(readFileSync(file, 'utf8'))
    if (value === undefined) throw new Error(`${file} is not a JSON object, so ${folder} was not added to its trustedFolders`)
    config = value
  }
  const trusted = Array.isArray(config.trustedFolders) ? config.trustedFolders : []
  if (trusted.some((each) => typeof each === 'string' && samePath(each, folder, platform))) return
  const path = pathsOf(platform)
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, `${JSON.stringify({ ...config, trustedFolders: [...trusted, path.resolve(folder)] }, null, 2)}\n`)
}

function parseConfig(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** The transcript of a session in an account folder. */
export function eventsFile(dir: string, sessionId: string): string {
  return join(dir, 'session-state', sessionId, 'events.jsonl')
}
