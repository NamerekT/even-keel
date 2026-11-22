import type { ChangeField } from './history.js'
import type { TaskPriority, TaskStatus } from './model.js'

/**
 * The whole history of a project as its tracker keeps it, for the import into the built-in tracker (BTN-1399): every
 * task, closed, cancelled and duplicates too, with its journal, files and, where the tracker gives it, its change log.
 * The mirror of `ExportSource` (`export.ts`); an adapter gives it through `TaskSource.importSource`. Nothing is written.
 */

/** Who wrote a comment or made a change: the agent's account, the user, or another person of the tracker. */
export type ImportAuthorKind = 'agent' | 'user' | 'person'

export interface ImportAuthor {
  kind: ImportAuthorKind
  /** The name the tracker shows; `null` — it gives none. */
  name: string | null
}

/** A task the link points to. */
export interface ImportLink {
  /** The source's own id of the task. */
  ref: string
  /** The task's id as the tracker shows it. */
  id: string
  /** A task of another project: it is not imported, the plan counts it among what does not move. */
  foreign: boolean
}

/** A picture inside a text: the text carries `ref` where it stands, the file is one of the task's `files` by its `key`. */
export interface ImportImage {
  ref: string
  file: string
}

export interface ImportFile {
  /** Unique within the task: comments and images name the file by it. */
  key: string
  name: string
  /** MIME type; empty when the tracker does not say. */
  type: string
  /** bytes; `null` — the tracker does not say. */
  size: number | null
  /**
   * The bytes, or `{ gone }` with why when the tracker surely has no file: 404, 410 or its own "not found" (`fileGone`).
   * Anything else throws and stops the import, which a repeat goes on from this file: the network, a timeout, 429, 5xx,
   * and no access (401, 403). The one more `gone` is GitHub's upload its token gets no file of and no text links signed.
   * The import, not the adapter, writes the line of a file passed over (BTN-1458); `import-files.test.ts` holds every
   * adapter to this.
   */
  read(): Promise<Uint8Array | ImportGone>
}

/** An attachment the tracker has no file of: why, in English, for the log's line. */
export interface ImportGone {
  gone: string
}

/** An HTTP status that says the file is no more: passed over, not a stop. */
export const fileGone = (status: number): boolean => status === 404 || status === 410

export interface ImportTask {
  /** The source's own id of the task: the import keeps its progress by it. */
  ref: string
  number: number
  /** The task's id as the tracker shows it. */
  id: string
  title: string
  /** Markdown; pictures stand in it by their `images[].ref`, mentions of people as their names. */
  description: string
  images: ImportImage[]
  status: TaskStatus
  priority: TaskPriority
  milestone: string | null
  component: string | null
  labels: string[]
  /** Minutes of the agent's work. */
  estimate: number | null
  parent: ImportLink | null
  /** Each pair of the project's tasks stands on both sides: in one's `blocks` and in the other's `blockedBy`. */
  blocks: ImportLink[]
  blockedBy: ImportLink[]
  related: ImportLink[]
  /** ms */
  createdAt: number
  /** `null` — the tracker does not say. */
  createdBy: ImportAuthor | null
  /** When it last went into its closed status, ms; `null` — it is open, or the tracker does not say. */
  closedAt: number | null
  /**
   * The tracker's time of the task's last change, ms, moved by a new comment or file too: the last pass before the
   * switch passes over a task whose time stayed (BTN-1432). `null` — the tracker gives none, and the pass reads it again.
   */
  modifiedAt: number | null
}

export interface ImportComment {
  /** The source's own id of the comment. */
  ref: string
  author: ImportAuthor | null
  /** ms */
  at: number
  /** Markdown, as `ImportTask.description`. */
  body: string
  images: ImportImage[]
  /** `key`s of the task's files attached to the comment. */
  files: string[]
  /** The `ref` of the comment whose thread it answers; `null` — a comment of the task itself. */
  replyTo: string | null
}

/** A change of the change log. `from` and `to` as `TaskChange` keeps them: by name, a task by its id, an estimate in minutes. */
export interface ImportChange {
  /** ms */
  at: number
  author: ImportAuthor | null
  field: Exclude<ChangeField, 'created' | 'moved' | 'run' | 'description'>
  from: string | null
  to: string | null
}

/** Fields that hold one value: a change of one with no `from` came from the `to` of the field's change before it. */
const SCALAR_FIELDS: ReadonlySet<ImportChange['field']> = new Set(['title', 'status', 'priority', 'milestone', 'component', 'estimate', 'parent'])

/**
 * The change log with each missing `from` of a one-value field taken from the field's change before it, by time and
 * then by the log's order; the log's own `from` stays, and so does the empty one of a field's first change. Huly gives
 * no previous value of the status, the title or the estimate (BTN-1434). The log keeps its order and length: the import
 * goes on after the changes it wrote by their count.
 */
export function withBefore(changes: readonly ImportChange[]): ImportChange[] {
  const out = [...changes]
  const last = new Map<ImportChange['field'], string | null>()
  const order = out.map((_, index) => index).sort((a, b) => out[a]!.at - out[b]!.at || a - b)
  for (const index of order) {
    const change = out[index]!
    if (!SCALAR_FIELDS.has(change.field)) continue
    if (change.from === null && last.has(change.field)) out[index] = { ...change, from: last.get(change.field)! }
    last.set(change.field, change.to)
  }
  return out
}

/** A milestone's status as the built-in tracker keeps it (BTN-1287). */
export type ImportMilestoneStatus = 'planned' | 'active' | 'completed' | 'canceled'

/** The fields of a milestone a tracker may not keep. */
export type ImportMilestoneField = 'date' | 'status' | 'description' | 'closedAt'

/** A milestone of the project (BTN-1436). A field the tracker does not keep is empty and named in `milestoneGaps`. */
export interface ImportMilestone {
  name: string
  /** The target date, ms; `null` — none. */
  date: number | null
  status: ImportMilestoneStatus
  /** Markdown; empty — none. */
  description: string
  /** When it was completed or canceled, ms; `null` — it is open, or the tracker does not say. */
  closedAt: number | null
}

export interface ImportSource {
  /** Every task of the project, closed ones too; by number. */
  tasks(): Promise<ImportTask[]>
  /** Every milestone of the project, those without tasks too; a name once. */
  milestones(): Promise<ImportMilestone[]>
  /** The milestone fields the tracker does not keep: the plan names them among what does not move. */
  milestoneGaps?: readonly ImportMilestoneField[]
  /** The journal, oldest first; a reply right after the comments before it in time. */
  comments(ref: string): Promise<ImportComment[]>
  /** The task's attachments, its comments' and the pictures of its texts, each once. */
  files(ref: string): Promise<ImportFile[]>
  /** The change log, oldest first; absent — the tracker gives none, and the plan names it among what does not move. */
  changes?(ref: string): Promise<ImportChange[]>
  /** The tracker keeps time reports the import does not read: the plan names them among what does not move. */
  timeReports?: boolean
  /**
   * How many tasks the plan reads at once (`PLAN_PARALLEL` where absent). A task's journal, change log and files are
   * asked for together, in one tick: a source caching the last task's thread serves both from one read.
   */
  parallel?: number
  /**
   * Whether a refusal of the tracker passes by itself — an overloaded server, a dropped connection, 429, 5xx — and is
   * worth asking again (BTN-1460). The adapter decides, as `fileGone` for a file that is no more; absent — none is, and
   * every refusal stops at once. `retryingSource` asks again.
   */
  transient?(error: unknown): boolean
}
