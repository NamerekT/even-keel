import type { ArchivePage } from '../state.js'
import type { TrackerLink } from '../tracker/link.js'
import { isLeaf, type Task } from '../tracker/model.js'
import { ownsMilestone, type ChainRules } from './rules.js'

/** The tasks of one page of the archive, as the page unfolds it. */
export const ARCHIVE_PAGE = 16
/** The most a tracker is asked for in one request. */
const REQUEST_LIMIT = 100
/** Requests for one page whose tasks are all in the state already, before the page comes back empty with a cursor. */
const REFILLS = 4
/** Requests while looking for the task a link opens, before giving up on it. */
const FOCUS_REQUESTS = 50

export interface ArchivePagesDeps {
  /** The project's readers in order: the project, then its feeds. */
  readers: (project: string) => string[]
  linkOf: (reader: string) => Pick<TrackerLink, 'run'> | undefined
  rulesOf: (reader: string) => ChainRules
  /** The ids of the project's tasks the page already has in the state, open and closed. */
  shown: (project: string) => ReadonlySet<string>
}

interface Cursor {
  /** The reader's index. */
  r: number
  /** The tracker's cursor within the reader; `null` — its first page. */
  a: string | null
}

/**
 * `archive/page` (BTN-1445): the project's closed tasks of any milestone and age past `after`, the readers one by one.
 * The tasks the state holds are left out, so a request asks the tracker for a page plus those; a page they fill whole is
 * asked again, up to `REFILLS` times. With `focus` it pages on until that task is among them.
 */
export async function archivePage(deps: ArchivePagesDeps, project: string, after: string | null, focus?: string): Promise<ArchivePage> {
  const readers = deps.readers(project)
  const shown = deps.shown(project)
  let cursor: Cursor | null = after === null ? { r: 0, a: null } : parseCursor(after)
  const tasks: Task[] = []
  let requests = 0
  while (cursor !== null && cursor.r < readers.length) {
    const reader = readers[cursor.r]!
    const link = deps.linkOf(reader)
    const rules = deps.rulesOf(reader)
    const page = link === undefined ? null : await link.run(async (tracker) => (tracker.closedPage === undefined ? null : await tracker.closedPage(reader, rules, { after: cursor!.a, limit: Math.min(REQUEST_LIMIT, ARCHIVE_PAGE + shown.size) })))
    requests += 1
    tasks.push(...(page?.tasks ?? []).filter((task) => !shown.has(task.id) && isLeaf(task) && ownsMilestone(rules, task) && !tasks.some((each) => each.id === task.id)))
    cursor = page !== null && page.next !== null ? { r: cursor.r, a: page.next } : { r: cursor.r + 1, a: null }
    const found = focus === undefined || tasks.some((task) => task.id === focus)
    if ((tasks.length > 0 && found) || requests >= (focus === undefined ? REFILLS : FOCUS_REQUESTS)) break
  }
  return { tasks, next: cursor === null || cursor.r >= readers.length ? null : JSON.stringify(cursor) }
}

function parseCursor(text: string): Cursor | null {
  try {
    const parsed = JSON.parse(text) as Partial<Cursor>
    return typeof parsed.r === 'number' && (typeof parsed.a === 'string' || parsed.a === null) ? { r: parsed.r, a: parsed.a } : null
  } catch {
    return null
  }
}
