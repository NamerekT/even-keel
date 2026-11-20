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
  /** The bytes; `null` — they are gone. */
  read(): Promise<Uint8Array | null>
}

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

export interface ImportSource {
  /** Every task of the project, closed ones too; by number. */
  tasks(): Promise<ImportTask[]>
  /** The journal, oldest first; a reply right after the comments before it in time. */
  comments(ref: string): Promise<ImportComment[]>
  /** The task's attachments, its comments' and the pictures of its texts, each once. */
  files(ref: string): Promise<ImportFile[]>
  /** The change log, oldest first; absent — the tracker gives none, and the plan names it among what does not move. */
  changes?(ref: string): Promise<ImportChange[]>
}
