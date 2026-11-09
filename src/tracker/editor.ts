import type { LabelChange } from './labels.js'
import type { TaskPriority, TrackerTask } from './model.js'

/** A new task with every field at once (`TaskEditor.create`); names, not ids, everywhere. */
export interface TaskDraft {
  title: string
  /** Markdown. */
  description: string
  /** `null` — the tracker's default for a new task. */
  status: string | null
  priority: TaskPriority | null
  milestone: string | null
  labels: string[]
  /** The parent's id, of the same project. */
  parent: string | null
  /** Minutes of the agent's active work (BTN-893), given only to an editor with `estimate`; absent or `null` — none. */
  estimate?: number | null
  /** A component's name (BTN-895), given only to an editor with `components`; absent or `null` — none. */
  component?: string | null
}

/** A short field set to a value, whatever it holds now: a field changed by someone else meanwhile is no conflict. */
export type TaskField =
  | { field: 'title'; to: string }
  | { field: 'status'; to: string }
  | { field: 'priority'; to: TaskPriority }
  | { field: 'milestone'; to: string | null }
  /** The parent's id; `null` — no parent. */
  | { field: 'parent'; to: string | null }
  /** Only for an editor with `components`: the task's one component; `null` — none. */
  | { field: 'component'; to: string | null }

/** A file of the session's working folder the service read for the tracker (BTN-895). */
export interface TaskUpload {
  name: string
  /** MIME type; `application/octet-stream` when the name does not tell. */
  type: string
  bytes: Uint8Array
}

/**
 * Files on a tracker that takes them (BTN-895). Where a tracker keeps a file only as a link in a text (GitLab), the
 * link goes into the description or the comment.
 */
export interface TaskFiles {
  /** Attaches the files to the task. */
  attach(id: string, files: readonly TaskUpload[], notes?: string[]): Promise<void>
  /** Posts the agent's comment with the files, as `TaskEditor.comment` does, and returns its id. */
  comment(id: string, body: string, files: readonly TaskUpload[], model: string | null, notes?: string[]): Promise<string>
}

/** The Markdown links of uploaded files, a line each: an image is shown, any other file is a link. */
export function fileLinks(files: readonly { name: string; type: string; url: string }[]): string {
  const label = (name: string) => name.replace(/[[\]\\]/g, '\\$&')
  return files.map((each) => `${each.type.startsWith('image/') ? '!' : ''}[${label(each.name)}](${each.url.replace(/[()\s]/g, encodeURIComponent)})`).join('\n')
}

/** A comment's body with the links of its files after it. */
export const withFileLinks = (body: string, links: string) => (links === '' ? body : `${body.trimEnd()}\n\n${links}`)

/** `blocks` — the task blocks the other; `blockedBy` — the other blocks it; `relates` has no direction. */
export type TaskLink = 'blocks' | 'blockedBy' | 'relates'

/** `old` is replaced with `new`; `old` must be in the text exactly once. */
export interface TextPatch {
  old: string
  new: string
}

/**
 * The writes an agent makes through the tasks MCP server (BTN-768, `src/taskmcp/`): optional for an adapter, the tools
 * are served only for a tracker that has it. Everything is named as the tracker names it — a task by its id, a status, a
 * label, a milestone by its name; checking a label or a milestone against the project's vocabulary is the server's.
 * `notes` gets a line for the agent's answer when a text was written not as given (Huly's mark fixes, BTN-894).
 */
export interface TaskEditor {
  /** Every task of the project, whatever its status. */
  list(project: string): Promise<TrackerTask[]>
  /** Creates the task and returns its id; `marker` — one of `markers.make`, which the task is given. */
  create(project: string, draft: TaskDraft, notes?: string[], marker?: string): Promise<string>
  /**
   * The marker a new task is created with, kept where a person does not read it (BTN-905): a repeat of `tasks_create`
   * after a crash between a create and the save of its id finds the task by it instead of creating it again. Absent —
   * the tracker has no such place, and such a repeat can duplicate the task.
   */
  markers?: TaskMarkers
  /** `false` — the field held the value already. */
  set(id: string, field: TaskField): Promise<boolean>
  /**
   * Optional: the tracker keeps an estimate (BTN-893). Sets it to `minutes` of the agent's active work, converted to
   * the tracker's own unit; `false` — it held that already. Absent — the tools refuse an estimate for the tracker.
   */
  estimate?(id: string, minutes: number): Promise<boolean>
  /**
   * The tracker keeps components (Huly, Jira; BTN-895): a draft's `component` and the `component` field are its, the
   * names are the vocabulary's `components`. Absent — the tools have no component field for it.
   */
  components?: true
  /** Optional: the tracker takes files (BTN-895). Absent — the tools have no `attach` for it. */
  files?: TaskFiles
  /**
   * Optional, where a priority is one of the project's labels (GitHub, GitLab, Forgejo): whether `labels` hold one.
   * Absent — the tracker has a priority of its own.
   */
  priorities?(labels: string[]): boolean
  /** The description's revision: it grows only with a change of the description, not of any other field. */
  revision(id: string): Promise<number>
  /** Replaces the description whole; refused when its revision is not `rev` any more. `false` — the text was the same. */
  describe(id: string, text: string, rev: number, notes?: string[]): Promise<boolean>
  /**
   * Applies the patches and the appended section by `patchText`, all or none, against the description as it is when
   * written: no revision needed. `false` — it is so already.
   */
  patch(id: string, patches: readonly TextPatch[], append: string | null, notes?: string[]): Promise<boolean>
  /** Adds or removes a link to another task; adding one there already, or removing one not there, is nothing. */
  link(id: string, other: string, link: TaskLink, on: boolean): Promise<void>
  /** Removes, then adds labels, ignoring case; returns the task's labels. */
  relabel(id: string, change: LabelChange): Promise<string[]>
  /** Posts the agent's comment and returns its id; `model` — `<Provider> | <model>` of its session, if known. */
  comment(id: string, body: string, model: string | null, notes?: string[]): Promise<string>
}

/**
 * A marker is made before the create, random, so a retry key used again after eviction never meets an old task; where
 * the tracker lets the caller choose a new task's own id, the marker is that id.
 */
export interface TaskMarkers {
  make(): string
  /** The id of the project's task created with the marker; `null` — there is none. */
  find(project: string, marker: string): Promise<string | null>
}

/** A write the tools refuse with a reason the agent can act on; the message is English and complete. */
export class EditRefused extends Error {}

/** A task's description as a tracker reads and writes it whole, in Markdown. */
export interface DescriptionStore {
  read(id: string): Promise<string>
  write(id: string, text: string): Promise<void>
}

/**
 * `revision`, `describe` and `patch` of a tracker that keeps no revision of a description of its own: the revision is
 * `revisionOf` the text, a patch is a read, `patchText` and a whole write, with no lock between the read and the write.
 */
export function descriptionEdits(store: DescriptionStore): Pick<TaskEditor, 'revision' | 'describe' | 'patch'> {
  return {
    revision: async (id) => revisionOf(await store.read(id)),
    async describe(id, text, rev) {
      const now = await store.read(id)
      if (revisionOf(now) !== rev) {
        throw new EditRefused(`${id}: the description was changed since rev ${rev} (now rev ${revisionOf(now)}); read it again, or patch it with "replace"`)
      }
      if (lf(now).trim() === lf(text).trim()) return false
      await store.write(id, text)
      return true
    },
    async patch(id, patches, append) {
      const next = patchText(await store.read(id), patches, append)
      if (next === null) return false
      await store.write(id, next)
      return true
    },
  }
}

/**
 * The description's revision on a tracker that keeps none fit for it (an `updated_at` grows with any field): a 32-bit
 * FNV-1a hash of its Markdown with line ends as `\n`. It changes with the text only, never with another field.
 */
export function revisionOf(markdown: string): number {
  let hash = 0x811c9dc5
  for (const char of lf(markdown).trim()) {
    hash ^= char.codePointAt(0)!
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * The description after the patches and the appended section, `null` when nothing changes. Each `old` must be found
 * exactly once, compared literally but for line ends (`\r\n` is `\n`); one refusal refuses the whole batch. A patch
 * already applied — its `old` gone and its `new` there, or its `old` found only inside its `new` — is skipped, so
 * a repeated call is no error; a section the text already ends with is not appended again.
 */
export function patchText(text: string, patches: readonly TextPatch[], append: string | null): string | null {
  const crlf = text.includes('\r\n')
  const start = lf(text)
  let work = start
  patches.forEach((patch, index) => {
    const old = lf(patch.old)
    const next = lf(patch.new)
    const which = patches.length === 1 ? 'the patch' : `patch ${index + 1}`
    if (old === '') throw new EditRefused(`${which}: "old" is empty; to add text, use "append" or a patch around a piece of the text`)
    const at = occurrences(work, old)
    if (at.length === 1) {
      if (!within(work, at[0]!, old, next)) work = work.slice(0, at[0]) + next + work.slice(at[0]! + old.length)
      return
    }
    if (at.length === 0) {
      if (next !== '' && work.includes(next)) return
      throw new EditRefused(`${which}: "old" is not in the description; nothing was changed. The description now:\n\n${work}`)
    }
    throw new EditRefused(`${which}: "old" is found ${at.length} times; take a longer piece so it is found once. Nothing was changed`)
  })
  const section = append === null ? '' : lf(append).trim()
  if (section !== '' && !work.trimEnd().endsWith(section)) work = work.trim() === '' ? section : `${work.trimEnd()}\n\n${section}`
  if (work === start) return null
  return crlf ? work.replace(/\n/g, '\r\n') : work
}

function lf(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

function occurrences(text: string, part: string): number[] {
  const found: number[] = []
  for (let at = text.indexOf(part); at >= 0; at = text.indexOf(part, at + 1)) found.push(at)
  return found
}

/** The one `old` at `at` sits inside a `new` that holds it: the patch was applied already. */
function within(text: string, at: number, old: string, next: string): boolean {
  for (const offset of occurrences(next, old)) if (at >= offset && text.startsWith(next, at - offset)) return true
  return false
}
