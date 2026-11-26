import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OWN_SKILLS } from '../account/share.js'
import { CLAUDE } from '../claude/name.js'
import { CODEX } from '../codex/name.js'
import type { MenuEntry } from './commands.js'

/** A plugin a session gets as a package, and its folder in the hub's package cache. */
export interface MenuPlugin {
  plugin: string
  dir: string
}

export interface MenuPlaces {
  /** The hub's copy of the user's configuration (`configStore`). */
  configFolder: string
  plugins: readonly MenuPlugin[]
  /** `skillOverrides` the session's settings carry; a name set to `off` is not in its menu. Claude Code's alone. */
  overrides?: Record<string, unknown>
  /** The session's agent; absent — Claude. */
  agent?: string
}

/**
 * The chat's `/` menu beyond Even Keel's own commands (BTN-1695, `docs/web/session-panel/turn.md`): the user's commands
 * and skills, then the packages' — each part by name, the first of two entries with one name kept. Read from the disk
 * on every call, so it follows the configuration and the packages without a restart. Codex (BTN-1737) gets only the
 * skills, as `codexMenu` reads them; any other agent, nothing.
 */
export function chatMenu(places: MenuPlaces): MenuEntry[] {
  const agent = places.agent ?? CLAUDE
  if (agent !== CLAUDE && agent !== CODEX) return []
  const byName = (a: MenuEntry, b: MenuEntry) => a.name.localeCompare(b.name)
  const codex = agent === CODEX
  const user = (codex ? codexMenu(places.configFolder, '', 'user') : userMenu(places.configFolder)).sort(byName)
  const packages = places.plugins.flatMap(({ plugin, dir }) => (codex ? codexMenu(dir, `${plugin}:`, 'package') : pluginMenu(plugin, dir))).sort(byName)
  const seen = new Set<string>()
  const overrides = codex ? {} : (places.overrides ?? {})
  return [...user, ...packages].filter((entry) => {
    if (seen.has(entry.name) || overrides[entry.name] === 'off') return false
    seen.add(entry.name)
    return true
  })
}

/** The commands (`commands/*.md`) and skills (`skills/<name>/SKILL.md`) of the configuration copy. */
export function userMenu(folder: string): MenuEntry[] {
  return entriesIn(folder, '', 'user')
}

/** A package plugin's commands and skills, named `<plugin>:<name>` as the CLI calls them. */
export function pluginMenu(plugin: string, dir: string): MenuEntry[] {
  return entriesIn(dir, `${plugin}:`, 'package')
}

/**
 * The skills of a folder as Codex calls them (BTN-1737): it reads no commands, names a skill by its frontmatter's
 * `name` (the folder when there is none) and a plugin's as `<plugin>:<name>`. The store's own folders (`OWN_SKILLS`)
 * are not linked into `~/.agents/skills`, so they are not Codex's.
 */
function codexMenu(folder: string, prefix: string, from: MenuEntry['from']): MenuEntry[] {
  return names(join(folder, 'skills'), true)
    .filter((name) => !OWN_SKILLS.has(name) && !name.startsWith('.'))
    .flatMap((name) => entryOf(join(folder, 'skills', name, 'SKILL.md'), name, 'skill', from, prefix))
}

function entriesIn(folder: string, prefix: string, from: MenuEntry['from']): MenuEntry[] {
  const commands = names(join(folder, 'commands'), false)
    .filter((name) => name.endsWith('.md'))
    .flatMap((name) => entryOf(join(folder, 'commands', name), `${prefix}${name.slice(0, -3)}`, 'command', from))
  const skills = names(join(folder, 'skills'), true).flatMap((name) => entryOf(join(folder, 'skills', name, 'SKILL.md'), `${prefix}${name}`, 'skill', from))
  return [...commands, ...skills]
}

/**
 * Claude calls a skill by its folder's name, whatever its frontmatter's `name` says; with `codexPrefix` set the name
 * is the frontmatter's under that prefix. `user-invocable: false` has no `/name`.
 */
function entryOf(file: string, name: string, kind: MenuEntry['kind'], from: MenuEntry['from'], codexPrefix?: string): MenuEntry[] {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const fields = frontmatterOf(text)
  if (fields['user-invocable'] === 'false') return []
  const called = codexPrefix === undefined ? name : `${codexPrefix}${fields.name || name}`
  return [{ name: called, kind, from, description: fields.description ?? '', args: fields['argument-hint'] ?? '' }]
}

function names(folder: string, directories: boolean): string[] {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => (directories ? entry.isDirectory() || entry.isSymbolicLink() : entry.isFile() || entry.isSymbolicLink()))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/**
 * The top-level keys of a Markdown file's frontmatter as text: plain and quoted values, and `>`/`|` blocks of the
 * indented lines under them. Enough for `description`, `argument-hint` and `user-invocable`; not a YAML parser.
 */
export function frontmatterOf(text: string): Record<string, string> {
  const head = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text.replace(/^﻿/, '').replace(/\r\n/g, '\n'))
  if (head === null) return {}
  const fields: Record<string, string> = {}
  const lines = head[1]!.split('\n')
  for (let at = 0; at < lines.length; at++) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[at]!)
    if (match === null || Object.hasOwn(fields, match[1]!)) continue
    const value = match[2]!.trim()
    const block = /^([>|])[-+]?$/.exec(value)
    if (block === null) {
      fields[match[1]!] = unquote(value)
      continue
    }
    const body: string[] = []
    while (at + 1 < lines.length && (/^\s/.test(lines[at + 1]!) || lines[at + 1] === '')) body.push(lines[++at]!.trim())
    fields[match[1]!] = (block[1] === '>' ? body.join(' ').replace(/\s+/g, ' ') : body.join('\n')).trim()
  }
  return fields
}

function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value)
  return quoted === null ? value : quoted[2]!
}
