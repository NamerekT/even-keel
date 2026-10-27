import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AccountStatus } from '../account/model.js'

/**
 * A Copilot account folder is a `COPILOT_HOME` (BTN-215, `docs/accounts.md`): the CLI keeps its config, its
 * `mcp-config.json` and the transcripts `session-state/<id>/events.jsonl` there. The sign-in is a GitHub token Even
 * Keel keeps in the folder's `even-keel.json` and hands to the CLI as `COPILOT_GITHUB_TOKEN`; the CLI's own sign-in
 * (`copilot login`) goes to the OS credential store, shared by every folder, so it is the account of a folder without
 * a token.
 */
const TOKEN_FILE = 'even-keel.json'

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
 * same way); one without runs on the CLI's own sign-in, which Even Keel cannot read (it is in the OS credential store),
 * so it counts as signed in with the method `none`.
 */
export function parseAuth(token: string | null): AccountStatus {
  return { loggedIn: true, authMethod: token === null ? 'none' : 'api_key', email: null, orgName: null, subscriptionType: null }
}

/** The transcript of a session in an account folder. */
export function eventsFile(dir: string, sessionId: string): string {
  return join(dir, 'session-state', sessionId, 'events.jsonl')
}
