/**
 * The person's unsaved edits of a built-in task's card, kept in the browser until the service takes them (BTN-1027):
 * an edit sent as the card or the tab closes may never get its answer, and a note is never sent on its own. Only what
 * the person typed is kept, never the tracker's own data; keyed by the project's GUID, since project keys are not unique.
 */
export type DraftField = 'title' | 'description' | 'note'

/** The value the field held when the edit began and the edited one; a note's `from` is empty. */
export interface FieldDraft {
  from: string
  to: string
}

export type DraftStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** A `keepalive` request's body is capped at 64 KiB for all of them in flight: room is left for a title sent with it. */
export const KEEPALIVE_BYTES = 60_000

const keyOf = (project: string, task: string, field: DraftField) => `even-keel.draft.${project}.${task}.${field}`

function browserStore(): DraftStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readDraft(project: string, task: string, field: DraftField, store: DraftStore | null = browserStore()): FieldDraft | null {
  try {
    const raw = store?.getItem(keyOf(project, task, field))
    if (raw == null) return null
    const draft = JSON.parse(raw) as Partial<FieldDraft>
    return typeof draft.from === 'string' && typeof draft.to === 'string' ? { from: draft.from, to: draft.to } : null
  } catch {
    return null
  }
}

// A browser that keeps no storage loses the draft with the tab, as before.
export function writeDraft(project: string, task: string, field: DraftField, draft: FieldDraft, store: DraftStore | null = browserStore()): void {
  try {
    store?.setItem(keyOf(project, task, field), JSON.stringify(draft))
  } catch {
    // nothing to keep it in
  }
}

export function dropDraft(project: string, task: string, field: DraftField, store: DraftStore | null = browserStore()): void {
  try {
    store?.removeItem(keyOf(project, task, field))
  } catch {
    // nothing to drop it from
  }
}

/** A draft found when the card opens: none when the field already holds it, else the edit to send again. */
export function leftoverOf(draft: FieldDraft | null, current: string): FieldDraft | null {
  return draft === null || draft.to === current ? null : draft
}

export function fitsKeepalive(body: string): boolean {
  return new TextEncoder().encode(body).length <= KEEPALIVE_BYTES
}
