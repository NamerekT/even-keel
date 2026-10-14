import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { asNotice, type Notice } from '../notice/notice.js'
import { writeAtomic } from '../storage/atomic.js'
import { byMap, inverted, isRecord, renameChainProjects } from '../storage/projects.js'
import { isVersionLine, refuseNewer, SCHEMA_VERSION, versionOf } from '../storage/schema.js'
import type { PostedQuestion } from '../tracker/questions.js'
import { emptyChainState, type ActiveChain, type ChainState, type CurrentTask, type LaunchEntry, type Leftover } from './dispatcher.js'

/**
 * The files name a project by its id, the running service by its key: `ids` is the id of each key from the config.
 * An id the config does not have — a removed project — stays as it is.
 */
export function loadChainState(file: string, ids: Record<string, string> = {}): ChainState {
  const raw = readIfExists(file)
  if (raw === undefined) return emptyChainState()
  let parsed: unknown = {}
  try {
    parsed = JSON.parse(raw) ?? {}
  } catch {}
  refuseNewer(file, versionOf(parsed))
  const { version: _, ...stored } = isRecord(parsed) ? renameChainProjects(parsed, byMap(inverted(ids))) : {}
  const state = stored as Omit<Partial<ChainState>, 'active'> & { active?: unknown }
  const chains = activeOf(state.active)
  const valid = chains !== undefined && Array.isArray(state.queue) && typeof state.orders === 'object' && state.orders !== null
  if (!valid) throw new Error(`chain: ${file} is damaged; fix or delete it`)
  const active = chains.map((chain) => ({ ...chain, current: settled(chain.current), error: noticeOrNull(chain.error) }))
  return { ...state, active, skipped: state.skipped ?? {}, leftovers: leftoversOf(state.leftovers), released: state.released ?? {}, unattended: state.unattended === true, trimTools: state.trimTools !== false, ci: state.ci ?? {} } as ChainState
}

// Before BTN-67 one chain ran at a time and `active` was that chain or null.
function activeOf(raw: unknown): ActiveChain[] | undefined {
  const chains = raw === null ? [] : Array.isArray(raw) ? raw : [raw]
  const valid = chains.every((chain) => typeof chain === 'object' && chain !== null && typeof (chain as ActiveChain).project === 'string')
  return valid ? (chains as ActiveChain[]) : undefined
}

// A start cut short by a service restart is not running any more.
function settled(current: CurrentTask | null | undefined): CurrentTask | null {
  if (current == null) return null
  const { starting: _, ...rest } = current
  return rest
}

// Before BTN-62 the pause reason and the leftovers were English strings; they are kept and shown as they are.
function noticeOrNull(value: unknown): Notice | null {
  return value === null || value === undefined ? null : asNotice(value)
}

function leftoversOf(stored: Record<string, unknown[]> | undefined): Record<string, Leftover[]> {
  const result: Record<string, Leftover[]> = {}
  for (const [project, list] of Object.entries(stored ?? {})) {
    result[project] = list.map((entry) => {
      const { task, at, notice, text } = entry as Partial<Leftover> & { text?: unknown }
      return { task: String(task), at: String(at), notice: asNotice(notice ?? text) }
    })
  }
  return result
}

export function saveChainState(file: string, state: ChainState, ids: Record<string, string> = {}): void {
  const stored = renameChainProjects(state as unknown as Record<string, unknown>, byMap(ids))
  writeAtomic(file, JSON.stringify({ version: SCHEMA_VERSION, ...stored }, null, 2))
}

/** A new log opens with the line `{"version":2}`. */
export function appendLaunch(file: string, entry: LaunchEntry, ids: Record<string, string> = {}): void {
  mkdirSync(dirname(file), { recursive: true })
  const head = (readIfExists(file) ?? '').trim() === '' ? `${JSON.stringify({ version: SCHEMA_VERSION })}\n` : ''
  appendFileSync(file, head + JSON.stringify({ ...entry, project: byMap(ids)(entry.project) }) + '\n')
}

/** Without `ids` the entries name projects as the file does — by id; Tally reads them so. */
export function readLaunches(file: string, ids?: Record<string, string>): LaunchEntry[] {
  const raw = readIfExists(file)
  if (raw === undefined) return []
  const lines = raw
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as unknown)
  if (isVersionLine(lines[0])) refuseNewer(file, versionOf(lines.shift()))
  if (ids === undefined) return lines as LaunchEntry[]
  const keyOf = byMap(inverted(ids))
  return (lines as LaunchEntry[]).map((entry) => ({ ...entry, project: keyOf(entry.project) }))
}

/** The questions Even Keel posted to the tracker; an older file was the bare list. */
export function loadQuestions(file: string): PostedQuestion[] {
  const raw = readIfExists(file)
  if (raw === undefined) return []
  const parsed = JSON.parse(raw) as unknown
  if (Array.isArray(parsed)) return parsed as PostedQuestion[]
  refuseNewer(file, versionOf(parsed))
  return isRecord(parsed) && Array.isArray(parsed.questions) ? (parsed.questions as PostedQuestion[]) : []
}

export function saveQuestions(file: string, questions: PostedQuestion[]): void {
  writeAtomic(file, `${JSON.stringify({ version: SCHEMA_VERSION, questions }, null, 2)}\n`)
}

function readIfExists(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
