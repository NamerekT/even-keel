/** What the composer keeps of an unsent reply; the picks of an open question are not part of it. */
export interface Draft {
  text: string
  files: File[]
}

export interface SavedDraft extends Draft {
  sessionId: string
  /** Epoch ms of the last change. */
  savedAt: number
}

/** A draft of a session the state does not know is kept this long: right after a start the service may not have read it yet. */
const UNKNOWN_GRACE_MS = 24 * 3_600_000

const DATABASE = 'even-keel'
const STORE = 'chatDrafts'

export function isBlank(draft: Draft): boolean {
  return draft.text.trim() === '' && draft.files.length === 0
}

/** The sessions a chat may still be opened for: the live ones and every one a task has had. */
export function knownSessions(state: { sessions: { sessionId: string }[]; taskSessions: Record<string, { sessionId: string }[]> }): Set<string> {
  return new Set([...state.sessions.map((session) => session.sessionId), ...Object.values(state.taskSessions).flatMap((runs) => runs.map((run) => run.sessionId))])
}

export function staleDrafts(saved: Pick<SavedDraft, 'sessionId' | 'savedAt'>[], known: Set<string>, now: number): string[] {
  return saved.filter((draft) => !known.has(draft.sessionId) && now - draft.savedAt > UNKNOWN_GRACE_MS).map((draft) => draft.sessionId)
}

let opened: Promise<IDBDatabase> | null = null

/** The browser's IndexedDB keeps a `File` as it is, which `localStorage` cannot. */
function database(): Promise<IDBDatabase> {
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'sessionId' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('cannot open IndexedDB'))
  }).catch((error: unknown) => {
    opened = null
    throw error
  })
  return opened
}

async function within<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database()
  return new Promise<T>((resolve, reject) => {
    const request = work(db.transaction(STORE, mode).objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

/** The draft of a session's chat, `null` without one or where the browser keeps nothing (a private window may refuse). */
export async function readDraft(sessionId: string): Promise<Draft | null> {
  try {
    const found = await within<SavedDraft | undefined>('readonly', (store) => store.get(sessionId) as IDBRequest<SavedDraft | undefined>)
    return found === undefined ? null : { text: found.text, files: found.files }
  } catch {
    return null
  }
}

/** Keeps the draft, or forgets it once it is blank — after a send too. */
export async function writeDraft(sessionId: string, draft: Draft): Promise<void> {
  try {
    if (isBlank(draft)) await within('readwrite', (store) => store.delete(sessionId))
    else await within('readwrite', (store) => store.put({ sessionId, text: draft.text, files: draft.files, savedAt: Date.now() } satisfies SavedDraft))
  } catch {
    // Nowhere to keep it: the draft lives only while the window is open, as before.
  }
}

/** Forgets the drafts of sessions that are gone. */
export async function pruneDrafts(known: Set<string>): Promise<void> {
  try {
    const saved = await within<SavedDraft[]>('readonly', (store) => store.getAll() as IDBRequest<SavedDraft[]>)
    for (const sessionId of staleDrafts(saved, known, Date.now())) await within('readwrite', (store) => store.delete(sessionId))
  } catch {
    // The same as a draft that cannot be written.
  }
}
