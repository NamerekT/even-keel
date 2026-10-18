import type { DatabaseSync } from 'node:sqlite'
import { asNotice, type Notice } from '../notice/notice.js'
import { inTransaction } from '../storage/database.js'
import { byMap, inverted, isRecord, renameChainProjects } from '../storage/projects.js'
import type { PostedQuestion } from '../tracker/questions.js'
import { emptyChainState, type ActiveChain, type ChainState, type CurrentTask, type LaunchEntry, type Leftover } from './dispatcher.js'

/**
 * The database names a project by its id, the running service by its key: `ids` is the id of each key from the config.
 * An id the config does not have — a removed project — stays as it is.
 */
export function loadChainState(db: DatabaseSync, ids: Record<string, string> = {}): ChainState {
  const stored = readChainRecord(db)
  return stored === undefined ? emptyChainState() : chainStateOf(stored, ids, 'the chain state')
}

/**
 * The chain state of a stored record — the database's, or a `state/chain.json` of v0.1 being imported — with the
 * projects renamed from their ids by `ids`. `where` names the record in the error of a damaged one.
 */
export function chainStateOf(parsed: unknown, ids: Record<string, string>, where: string): ChainState {
  const { version: _, ...stored } = isRecord(parsed) ? renameChainProjects(parsed, byMap(inverted(ids))) : {}
  const state = stored as Omit<Partial<ChainState>, 'active'> & { active?: unknown }
  const chains = activeOf(state.active)
  const valid = chains !== undefined && Array.isArray(state.queue) && typeof state.orders === 'object' && state.orders !== null
  if (!valid) throw new Error(`chain: ${where} is damaged; fix or delete it`)
  const active = chains.map((chain) => ({ ...chain, current: settled(chain.current), error: noticeOrNull(chain.error) }))
  return {
    active,
    queue: state.queue!,
    orders: state.orders!,
    skipped: state.skipped ?? {},
    leftovers: leftoversOf(state.leftovers),
    released: state.released ?? {},
    unattended: state.unattended === true,
    trimTools: state.trimTools !== false,
    ci: state.ci ?? {},
  }
}

// Before BTN-67 one chain ran at a time and `active` was that chain or null.
function activeOf(raw: unknown): ActiveChain[] | undefined {
  const chains = raw === null ? [] : Array.isArray(raw) ? raw : [raw]
  const valid = chains.every((chain) => typeof chain === 'object' && chain !== null && typeof (chain as ActiveChain).project === 'string')
  return valid ? (chains as ActiveChain[]) : undefined
}

// A start cut short by a service restart is not running any more; a move of a running session is kept for the
// chain to see through (`Handovers.recover`).
function settled(current: CurrentTask | null | undefined): CurrentTask | null {
  if (current == null) return null
  if (current.sessionId !== null && current.move !== undefined) return current
  const { starting: _, answering: __, move: ___, reply: ____, ask: _____, ...rest } = current
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

export function saveChainState(db: DatabaseSync, state: ChainState, ids: Record<string, string> = {}): void {
  writeChainRecord(db, renameChainProjects(state as unknown as Record<string, unknown>, byMap(ids)) as unknown as ChainState)
}

const LISTS = ['orders', 'skipped', 'leftovers', 'released', 'ci'] as const

/** The chain state as stored, projects by id; `undefined` — nothing was ever saved. */
function readChainRecord(db: DatabaseSync): Record<string, unknown> | undefined {
  const flags = db.prepare('SELECT name, value FROM chain_flags').all() as { name: string; value: string }[]
  if (flags.length === 0) return undefined
  const record: Record<string, unknown> = Object.fromEntries(flags.map(({ name, value }) => [name, JSON.parse(value)]))
  const chains = db.prepare('SELECT project_id, chain FROM chains ORDER BY position').all() as { project_id: string; chain: string }[]
  record.active = chains.map(({ project_id, chain }) => ({ project: project_id, ...(JSON.parse(chain) as object) }))
  record.queue = (db.prepare('SELECT project_id FROM chain_queue ORDER BY position').all() as { project_id: string }[]).map((row) => row.project_id)
  for (const list of LISTS) record[list] = {}
  const rows = db.prepare('SELECT project_id, list, value FROM chain_lists ORDER BY rowid').all() as { project_id: string; list: (typeof LISTS)[number]; value: string }[]
  for (const { project_id, list, value } of rows) (record[list] as Record<string, unknown>)[project_id] = JSON.parse(value)
  return record
}

/** Writes the whole chain state, projects by id, in place of the stored one. */
export function writeChainRecord(db: DatabaseSync, state: ChainState): void {
  inTransaction(db, () => {
    for (const table of ['chain_flags', 'chains', 'chain_queue', 'chain_lists']) db.exec(`DELETE FROM ${table}`)
    const flag = db.prepare('INSERT INTO chain_flags (name, value) VALUES (?, ?)')
    flag.run('unattended', JSON.stringify(state.unattended))
    flag.run('trimTools', JSON.stringify(state.trimTools))
    const chain = db.prepare('INSERT INTO chains (position, project_id, chain) VALUES (?, ?, ?)')
    state.active.forEach(({ project, ...rest }, position) => chain.run(position, project, JSON.stringify(rest)))
    const queued = db.prepare('INSERT INTO chain_queue (position, project_id) VALUES (?, ?)')
    state.queue.forEach((project, position) => queued.run(position, project))
    const list = db.prepare('INSERT INTO chain_lists (project_id, list, value) VALUES (?, ?, ?)')
    for (const name of LISTS) {
      for (const [project, value] of Object.entries(state[name] as Record<string, unknown>)) list.run(project, name, JSON.stringify(value))
    }
  })
}

export function appendLaunch(db: DatabaseSync, entry: LaunchEntry, ids: Record<string, string> = {}): void {
  const { at, project, task, sessionId, reason, ...extra } = entry
  db.prepare('INSERT INTO launches (at, project_id, task, session_id, reason, extra) VALUES (?, ?, ?, ?, ?, ?)').run(
    at,
    byMap(ids)(project),
    task,
    sessionId,
    reason ?? null,
    JSON.stringify(extra),
  )
}

/** Without `ids` the entries name projects as the database does — by id; Tally reads them so. */
export function readLaunches(db: DatabaseSync, ids?: Record<string, string>): LaunchEntry[] {
  const keyOf = ids === undefined ? (project: string) => project : byMap(inverted(ids))
  const rows = db.prepare('SELECT at, project_id, task, session_id, reason, extra FROM launches ORDER BY id').all() as {
    at: string
    project_id: string
    task: string
    session_id: string
    reason: string | null
    extra: string
  }[]
  return rows.map((row) => ({
    at: row.at,
    project: keyOf(row.project_id),
    task: row.task,
    sessionId: row.session_id,
    ...(row.reason === null ? {} : { reason: row.reason as LaunchEntry['reason'] }),
    ...(JSON.parse(row.extra) as Partial<LaunchEntry>),
  }))
}

/** The questions Even Keel posted to the tracker. */
export function loadQuestions(db: DatabaseSync): PostedQuestion[] {
  const rows = db.prepare('SELECT task, session_id, ask, comment, done FROM questions ORDER BY position').all() as {
    task: string
    session_id: string
    ask: string
    comment: string
    done: number
  }[]
  return rows.map((row) => ({ task: row.task, sessionId: row.session_id, ask: row.ask, comment: row.comment, ...(row.done === 1 ? { done: true } : {}) }))
}

export function saveQuestions(db: DatabaseSync, questions: PostedQuestion[]): void {
  inTransaction(db, () => {
    db.exec('DELETE FROM questions')
    const insert = db.prepare('INSERT INTO questions (position, task, session_id, ask, comment, done) VALUES (?, ?, ?, ?, ?, ?)')
    questions.forEach((question, position) => insert.run(position, question.task, question.sessionId, question.ask, question.comment, question.done === true ? 1 : 0))
  })
}

/** A task of the tracker the chain ran and saw closed: kept after the tracker forgets it or the project goes. */
export interface ClosedTask {
  project: string
  task: string
  tracker: string
  title: string
  url: string | null
  closedAt: string
}

/** A task closed again after a reopen keeps the latest title and time. */
export function saveClosedTask(db: DatabaseSync, closed: ClosedTask, ids: Record<string, string> = {}): void {
  db.prepare(
    `INSERT INTO closed_tasks (project_id, task, tracker, title, url, closed_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (project_id, task) DO UPDATE SET tracker = excluded.tracker, title = excluded.title, url = excluded.url, closed_at = excluded.closed_at`,
  ).run(byMap(ids)(closed.project), closed.task, closed.tracker, closed.title, closed.url, closed.closedAt)
}

export function closedTasks(db: DatabaseSync, ids: Record<string, string> = {}): ClosedTask[] {
  const keyOf = byMap(inverted(ids))
  const rows = db.prepare('SELECT project_id, task, tracker, title, url, closed_at FROM closed_tasks ORDER BY closed_at, rowid').all() as {
    project_id: string
    task: string
    tracker: string
    title: string
    url: string | null
    closed_at: string
  }[]
  return rows.map((row) => ({ project: keyOf(row.project_id), task: row.task, tracker: row.tracker, title: row.title, url: row.url, closedAt: row.closed_at }))
}
