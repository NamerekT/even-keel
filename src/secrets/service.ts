import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { guardToken } from '../guard.js'
import { fail } from '../notice/notice.js'
import { envLine, removeEnv, upsertEnv } from '../packages/keys.js'
import type { SecretsView, SecretView } from '../state.js'
import { PAGE_TOKEN, type SecretSpec } from './catalog.js'

export interface SecretsDeps {
  catalog: readonly SecretSpec[]
  envFile: string
  /** The global `settings.json`: sessions read its `env` at their start. */
  settingsFile: () => string
  env: NodeJS.ProcessEnv
  /** Set from outside `.env`: the process keeps that value whatever the file says. */
  outer: (name: string) => boolean
  /** `.env` was written: its readers take it now (`EnvFile.reload`). */
  applied: () => void
  /** The host the page listens on: a token is required beyond loopback. */
  host: () => string
  /** A key left the sessions' settings: the daemon of the global folder still hands it out until it restarts. */
  expired: () => void
  /** That daemon waits for its live sessions to end. */
  sessionsPending: () => boolean
  onChange: () => void
}

type Json = Record<string, unknown>

/**
 * The `.env` credentials of the "Access" tab: each is written alone, into one line of `.env` and, for one the sessions
 * read, into the `env` of the global `settings.json`. A secret's value goes in only: the view says whether it is set, never what it is.
 */
export class Secrets {
  private settings: { stamp: string; env: Json } = { stamp: '', env: {} }

  constructor(private readonly deps: SecretsDeps) {}

  view(): SecretsView {
    const { env } = this.deps
    const sessionEnv = this.sessionEnv()
    const required = guardRequired(this.deps.host())
    const variables = this.deps.catalog.map((spec): SecretView => {
      const value = env[spec.name] || null
      const session = typeof sessionEnv[spec.name] === 'string' ? (sessionEnv[spec.name] as string) : null
      return {
        name: spec.name,
        secret: spec.secret,
        places: spec.places,
        readers: spec.readers,
        set: value !== null,
        value: spec.secret ? null : value,
        outer: this.deps.outer(spec.name),
        sessions: !spec.places.includes('sessions') ? null : session === null ? 'none' : session === value ? 'same' : 'other',
        required: spec.name === PAGE_TOKEN && required,
      }
    })
    return { variables, sessionsPending: this.deps.sessionsPending() }
  }

  set(name: string, value: string): void {
    const spec = this.writable(name)
    if (value === '') throw fail('secrets.empty', { name })
    envLine(name, value)
    if (name === PAGE_TOKEN) guardToken({ [PAGE_TOKEN]: value }, this.deps.host())
    if (spec.places.includes('sessions')) this.writeSettings(name, value)
    this.writeEnv((text) => upsertEnv(text, name, value))
  }

  /**
   * Several `.env`-only variables in one write, so their readers restart once: the stats' own Postgres (BTN-247) and
   * its classifier (BTN-355). `null` removes one; the page token has its own guard and is never among them.
   */
  update(values: Record<string, string | null>): void {
    const entries = Object.entries(values)
    for (const [name, value] of entries) {
      if (this.writable(name).places.includes('sessions') || name === PAGE_TOKEN) throw fail('secrets.unknown', { name })
      if (value === '') throw fail('secrets.empty', { name })
      if (value !== null) envLine(name, value)
    }
    this.writeEnv((text) => entries.reduce((next, [name, value]) => (value === null ? removeEnv(next, name) : upsertEnv(next, name, value)), text))
  }

  remove(name: string): void {
    const spec = this.writable(name)
    if (name === PAGE_TOKEN && guardRequired(this.deps.host())) throw fail('secrets.tokenRequired', {})
    if (spec.places.includes('sessions') && this.writeSettings(name, null)) this.deps.expired()
    this.writeEnv((text) => removeEnv(text, name))
  }

  private writable(name: string): SecretSpec {
    const spec = this.deps.catalog.find((each) => each.name === name)
    if (spec === undefined) throw fail('secrets.unknown', { name })
    if (this.deps.outer(name)) throw fail('secrets.outer', { name })
    return spec
  }

  private writeEnv(edit: (text: string) => string): void {
    const before = readText(this.deps.envFile)
    const after = edit(before)
    if (after !== before) writeFileSync(this.deps.envFile, after)
    this.deps.applied()
    this.deps.onChange()
  }

  /** `true` — the file changed. */
  private writeSettings(name: string, value: string | null): boolean {
    const file = this.deps.settingsFile()
    const before = readText(file)
    const env = objectOf(settingsOf(before).env)
    if (value === null ? !Object.hasOwn(env, name) : env[name] === value) return false
    writeFileSync(file, withSessionEnv(before, name, value))
    return true
  }

  /** The `env` of the global settings, read again only once the file changed: the view is built on every broadcast. */
  private sessionEnv(): Json {
    const file = this.deps.settingsFile()
    let stamp: string
    try {
      const stats = statSync(file)
      stamp = `${file}:${stats.mtimeMs}:${stats.size}`
    } catch {
      return {}
    }
    if (stamp !== this.settings.stamp) {
      try {
        this.settings = { stamp, env: objectOf(settingsOf(readText(file)).env) }
      } catch {
        this.settings = { stamp, env: {} }
      }
    }
    return this.settings.env
  }
}

/** The text of `settings.json` with one key of its `env` set, or removed with `null`; the rest stays. */
export function withSessionEnv(text: string, name: string, value: string | null): string {
  const settings = settingsOf(text)
  if (settings.env !== undefined && objectOf(settings.env) !== settings.env) throw fail('secrets.settingsJson', {})
  const env = { ...objectOf(settings.env) }
  if (value === null) delete env[name]
  else env[name] = value
  const next: Json = { ...settings, env }
  if (Object.keys(env).length === 0) delete next.env
  return JSON.stringify(next, null, 2)
}

function settingsOf(text: string): Json {
  if (text.trim() === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw fail('secrets.settingsJson', {})
  }
  if (objectOf(parsed) !== parsed) throw fail('secrets.settingsJson', {})
  return parsed as Json
}

const objectOf = (value: unknown): Json => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {})

function guardRequired(host: string): boolean {
  try {
    guardToken({}, host)
    return false
  } catch {
    return true
  }
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}
