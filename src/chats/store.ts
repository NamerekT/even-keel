import type { Db, Queryable, Writes } from '../storage/database.js'
import { ARCHIVE_PAGE, type ChatChoice, type ChatMessage, type ChatRecord } from './model.js'

export interface ChatStoreDeps {
  db: Db
  writes: Writes
}

interface ChatRow {
  id: string
  project_id: string
  agent: string
  account: string
  model: string | null
  effort: string | null
  title: string | null
  first: string | null
  said: string
  last: string | null
  session_id: string | null
  machine_id: string | null
  created_at: string
  last_at: string
  read_at: string | null
  archived_at: string | null
  successor: string | null
  previous: string | null
  pending: string | null
  packages: string | null
  name: string | null
  handover: string | null
}

const COLUMNS = 'id, project_id, agent, account, model, effort, title, first, said, last, session_id, machine_id, created_at, last_at, read_at, archived_at, successor, previous, pending, packages, name, handover'

const iso = (ms: string | null): string | null => (ms === null ? null : new Date(Number(ms)).toISOString())
const ms = (at: string | null): number | null => (at === null ? null : Date.parse(at))

/** A chat's own choice of packages as kept (BTN-1696): `null` — none, and a value that does not parse is none too. */
function packagesOf(text: string | null): Record<string, boolean> {
  if (text === null) return {}
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'))
  } catch {
    return {}
  }
}

const packagesColumn = (packages: Record<string, boolean> | undefined): string | null =>
  packages === undefined || Object.keys(packages).length === 0 ? null : JSON.stringify(packages)

function recordOf(row: ChatRow): ChatRecord {
  return {
    id: row.id,
    project: row.project_id,
    agent: row.agent,
    account: row.account,
    model: row.model,
    effort: row.effort,
    title: row.title,
    name: row.name,
    first: row.first,
    said: row.said,
    last: row.last === null ? null : (JSON.parse(row.last) as ChatMessage),
    sessionId: row.session_id,
    machine: row.machine_id,
    createdAt: iso(row.created_at)!,
    lastAt: iso(row.last_at)!,
    readAt: iso(row.read_at),
    archivedAt: iso(row.archived_at),
    successor: row.successor,
    previous: row.previous,
    pending: row.pending,
    handover: row.handover,
    packages: packagesOf(row.packages),
  }
}

/** `%` and `_` of the user's words match themselves. */
const likeOf = (words: string): string => `%${words.replace(/[\\%_]/g, (char) => `\\${char}`)}%`

/**
 * The project chats (`chats`) and each project's last choice (`chat_choices`): the active chats read from memory, a
 * change written behind; the archive read from the database a page at a time.
 */
export class ChatStore {
  private readonly chats = new Map<string, ChatRecord>()
  private readonly choices = new Map<string, ChatChoice>()

  private constructor(private readonly deps: ChatStoreDeps, rows: ChatRecord[], choices: Array<[string, ChatChoice]>) {
    for (const row of rows) this.chats.set(row.id, row)
    for (const [project, choice] of choices) this.choices.set(project, choice)
  }

  static async open(deps: ChatStoreDeps): Promise<ChatStore> {
    const { rows } = await deps.db.query<ChatRow>(`select ${COLUMNS} from chats where archived_at is null order by created_at, id`)
    const choices = await deps.db.query<{ project_id: string; account: string; model: string | null; effort: string | null; packages: string | null; machine_id: string | null }>(
      'select project_id, account, model, effort, packages, machine_id from chat_choices',
    )
    return new ChatStore(deps, rows.map(recordOf), choices.rows.map((row) => {
      const packages = packagesOf(row.packages)
      return [row.project_id, {
        account: row.account,
        model: row.model,
        effort: row.effort,
        ...(Object.keys(packages).length > 0 && { packages }),
        ...(row.machine_id !== null && { machine: row.machine_id }),
      }]
    }))
  }

  /** The active chats, of one project or of all. */
  active(project?: string): ChatRecord[] {
    return [...this.chats.values()].filter((chat) => project === undefined || chat.project === project)
  }

  get(id: string): ChatRecord | undefined {
    return this.chats.get(id)
  }

  /** An active chat from memory, an archived one from the database. */
  async find(id: string): Promise<ChatRecord | undefined> {
    const active = this.chats.get(id)
    if (active !== undefined) return active
    await this.deps.writes.settled()
    const { rows } = await this.deps.db.query<ChatRow>(`select ${COLUMNS} from chats where id = $1`, [id])
    return rows[0] === undefined ? undefined : recordOf(rows[0])
  }

  /** Keeps the chat as it is now; an archived one leaves memory. */
  put(chat: ChatRecord): void {
    if (chat.archivedAt === null) this.chats.set(chat.id, chat)
    else this.chats.delete(chat.id)
    this.deps.writes.add(`the chat ${chat.id}`, this.deps.db.query(
      `insert into chats (${COLUMNS}) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
       on conflict (id) do update set title = excluded.title, name = excluded.name, first = excluded.first, said = excluded.said, last = excluded.last,
         session_id = excluded.session_id, machine_id = excluded.machine_id, last_at = excluded.last_at, read_at = excluded.read_at, archived_at = excluded.archived_at,
         successor = excluded.successor, previous = excluded.previous, pending = excluded.pending, handover = excluded.handover`,
      [
        chat.id, chat.project, chat.agent, chat.account, chat.model, chat.effort, chat.title, chat.first, chat.said,
        chat.last === null ? null : JSON.stringify(chat.last), chat.sessionId, chat.machine, ms(chat.createdAt), ms(chat.lastAt), ms(chat.readAt),
        ms(chat.archivedAt), chat.successor, chat.previous, chat.pending, packagesColumn(chat.packages), chat.name, chat.handover,
      ],
    ))
  }

  /** Forgets the chat for good: its row goes, not to the archive (BTN-1775, an empty chat). */
  remove(id: string): void {
    this.chats.delete(id)
    this.deps.writes.add(`the removal of the chat ${id}`, this.deps.db.query('delete from chats where id = $1', [id]))
  }

  choice(project: string): ChatChoice | null {
    return this.choices.get(project) ?? null
  }

  setChoice(project: string, choice: ChatChoice): void {
    this.choices.set(project, choice)
    this.deps.writes.add(`the chat choice of ${project}`, this.deps.db.query(
      `insert into chat_choices (project_id, account, model, effort, packages, machine_id) values ($1, $2, $3, $4, $5, $6)
       on conflict (project_id) do update set account = excluded.account, model = excluded.model, effort = excluded.effort, packages = excluded.packages,
         machine_id = excluded.machine_id`,
      [project, choice.account, choice.model, choice.effort, packagesColumn(choice.packages), choice.machine ?? null],
    ))
  }

  /**
   * Page `page` (from 0) of the project's archive, newest first; `words` — only the chats whose title or messages have
   * them. One row past the page tells whether an older page follows.
   */
  async archived(project: string, words: string, page: number): Promise<{ chats: ChatRecord[]; more: boolean }> {
    await this.deps.writes.settled()
    const search = words.trim()
    const filter = search === '' ? '' : `and (coalesce(name, '') ilike $4 or coalesce(title, '') ilike $4 or coalesce(first, '') ilike $4 or said ilike $4 or coalesce(last, '') ilike $4)`
    const params: unknown[] = [project, ARCHIVE_PAGE + 1, page * ARCHIVE_PAGE, ...(search === '' ? [] : [likeOf(search)])]
    const { rows } = await this.deps.db.query<ChatRow>(
      `select ${COLUMNS} from chats where project_id = $1 and archived_at is not null ${filter} order by archived_at desc, id limit $2 offset $3`,
      params,
    )
    return { chats: rows.slice(0, ARCHIVE_PAGE).map(recordOf), more: rows.length > ARCHIVE_PAGE }
  }
}

/** `[chat, sessionId]` of the machine's active chats with a session: handed back at its connection (`ChatSessions`, BTN-1772). */
export async function loadChatSessions(db: Queryable, machine: string): Promise<[string, string][]> {
  const { rows } = await db.query<{ id: string; session_id: string }>(
    'select id, session_id from chats where machine_id = $1 and archived_at is null and session_id is not null order by created_at, id',
    [machine],
  )
  return rows.map((row) => [row.id, row.session_id])
}
