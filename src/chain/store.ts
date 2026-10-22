import { asNotice, type Notice } from '../notice/notice.js'
import { insertList, inTransaction, type Db, type Queryable } from '../storage/database.js'
import { isRecord } from '../storage/projects.js'
import type { PostedQuestion } from '../tracker/questions.js'
import { emptyChainState, type ActiveChain, type ChainState, type CurrentTask, type LaunchEntry, type Leftover } from './dispatcher.js'

/** The database names a project by its id, as the running service does (BTN-271). */
export async function loadChainState(db: Queryable): Promise<ChainState> {
  return chainStateOf(await readChainRecord(db), 'the chain state')
}

/**
 * The chain state of a stored record — the database's, or a `state/chain.json` of v0.1 being imported. `where` names
 * the record in the error of a damaged one.
 */
export function chainStateOf(parsed: unknown, where: string): ChainState {
  const { version: _, ...stored } = isRecord(parsed) ? parsed : {}
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
    shelved: state.shelved ?? {},
    unattended: state.unattended === true,
    trimTools: state.trimTools !== false,
    ci: state.ci ?? {},
    reviews: state.reviews ?? {},
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

/** Starts its write at the call: see `Writes`. */
export function saveChainState(db: Db, state: ChainState): Promise<void> {
  return writeChainRecord(db, state)
}

const LISTS = ['orders', 'skipped', 'leftovers', 'released', 'shelved', 'ci', 'reviews'] as const

/**
 * The chain state as stored, projects by id. The switches are Even Keel's setting rows since BTN-199, written by the
 * settings' writer, not by `writeChainRecord`; they are read here for the v0.1 `chain.json` of the export.
 */
async function readChainRecord(db: Queryable): Promise<Record<string, unknown>> {
  const { rows: flags } = await db.query<{ key: string; value: string }>(
    "select key, value from setting_values where key in ('unattended', 'trimTools') and project_id is null and qualifier = ''",
  )
  const record: Record<string, unknown> = Object.fromEntries(flags.map(({ key, value }) => [key, JSON.parse(value)]))
  const { rows: chains } = await db.query<{ project_id: string; chain: string }>('select project_id, chain from chains order by position')
  record.active = chains.map(({ project_id, chain }) => ({ project: project_id, ...(JSON.parse(chain) as object) }))
  record.queue = (await db.query<{ project_id: string }>('select project_id from chain_queue order by position')).rows.map((row) => row.project_id)
  for (const list of LISTS) record[list] = {}
  const { rows } = await db.query<{ project_id: string; list: (typeof LISTS)[number]; value: string }>('select project_id, list, value from chain_lists order by list, project_id')
  for (const { project_id, list, value } of rows) (record[list] as Record<string, unknown>)[project_id] = JSON.parse(value)
  return record
}

/** Writes the whole chain state but its switches (`readChainRecord`), projects by id, in place of the stored one. */
export function writeChainRecord(db: Db, state: ChainState): Promise<void> {
  return inTransaction(db, async (tx) => {
    await tx.exec('delete from chains; delete from chain_queue; delete from chain_lists')
    await insertList(tx, 'chains', state.active.map(({ project, ...rest }, position) => ({ position, project_id: project, chain: JSON.stringify(rest) })))
    await insertList(tx, 'chain_queue', state.queue.map((project, position) => ({ position, project_id: project })))
    await insertList(
      tx,
      'chain_lists',
      LISTS.flatMap((list) => Object.entries(state[list] as Record<string, unknown>).map(([project, value]) => ({ project_id: project, list, value: JSON.stringify(value) }))),
    )
  })
}

export async function appendLaunch(db: Db, entry: LaunchEntry): Promise<void> {
  const { at, project, task, sessionId, reason, ...extra } = entry
  await db.query('insert into launches (at, project_id, task, session_id, reason, extra) values ($1, $2, $3, $4, $5, $6)', [
    at,
    project,
    task,
    sessionId,
    reason ?? null,
    JSON.stringify(extra),
  ])
}

export async function readLaunches(db: Queryable): Promise<LaunchEntry[]> {
  const { rows } = await db.query<{
    at: string
    project_id: string
    task: string
    session_id: string
    reason: string | null
    extra: string
  }>('select at, project_id, task, session_id, reason, extra from launches order by id')
  return rows.map((row) => ({
    at: row.at,
    project: row.project_id,
    task: row.task,
    sessionId: row.session_id,
    ...(row.reason === null ? {} : { reason: row.reason as LaunchEntry['reason'] }),
    ...(JSON.parse(row.extra) as Partial<LaunchEntry>),
  }))
}

/** The questions Even Keel posted to the tracker. */
export async function loadQuestions(db: Queryable): Promise<PostedQuestion[]> {
  const { rows } = await db.query<{
    task: string
    session_id: string
    ask: string
    comment: string
    done: boolean
  }>('select task, session_id, ask, comment, done from questions order by position')
  return rows.map((row) => ({ task: row.task, sessionId: row.session_id, ask: row.ask, comment: row.comment, ...(row.done ? { done: true } : {}) }))
}

export function saveQuestions(db: Db, questions: PostedQuestion[]): Promise<void> {
  return inTransaction(db, async (tx) => {
    await tx.query('delete from questions')
    await insertList(
      tx,
      'questions',
      questions.map((question, position) => ({ position, task: question.task, session_id: question.sessionId, ask: question.ask, comment: question.comment, done: question.done === true })),
    )
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
export async function saveClosedTask(db: Db, closed: ClosedTask): Promise<void> {
  await db.query(
    `insert into closed_tasks (project_id, task, tracker, title, url, closed_at) values ($1, $2, $3, $4, $5, $6)
     on conflict (project_id, task) do update set tracker = excluded.tracker, title = excluded.title, url = excluded.url, closed_at = excluded.closed_at`,
    [closed.project, closed.task, closed.tracker, closed.title, closed.url, closed.closedAt],
  )
}

export async function closedTasks(db: Queryable): Promise<ClosedTask[]> {
  const { rows } = await db.query<{
    project_id: string
    task: string
    tracker: string
    title: string
    url: string | null
    closed_at: string
  }>('select project_id, task, tracker, title, url, closed_at from closed_tasks order by closed_at, project_id, task')
  return rows.map((row) => ({ project: row.project_id, task: row.task, tracker: row.tracker, title: row.title, url: row.url, closedAt: row.closed_at }))
}
