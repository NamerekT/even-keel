/** What the composer keeps of an unsent reply; the picks of an open question are not part of it. */
export interface Draft {
  text: string
  files: File[]
}

/** A draft of a task's chat: one for all its sessions, so it outlives a handoff and the task's close. */
interface TaskDraft extends Draft {
  /** `draftKey` of the task. */
  key: string
  /** The task's id, for pruning against the state. */
  task: string
  /** Epoch ms of the last change. */
  savedAt: number
}

/** A draft kept by session before BTN-948; read once as a fallback and moved to its task. */
interface SessionDraft extends Draft {
  sessionId: string
  savedAt: number
}

/** A draft of a task or a session the state does not know is kept this long: right after a start the service may not have read it yet. */
const UNKNOWN_GRACE_MS = 24 * 3_600_000

const DATABASE = 'even-keel'
const SESSION_STORE = 'chatDrafts'
const TASK_STORE = 'taskDrafts'

export function isBlank(draft: Draft): boolean {
  return draft.text.trim() === '' && draft.files.length === 0
}

/** The draft of a chain row: its project, since a task key is not unique across projects, and its id. */
export function draftKey(project: string, task: string): string {
  return `${project}\u0000${task}`
}

/** The sessions a chat may still be opened for: the live ones and every one a task has had. */
export function knownSessions(state: { sessions: { sessionId: string }[]; taskSessions: Record<string, { sessionId: string }[]> }): Set<string> {
  return new Set([...state.sessions.map((session) => session.sessionId), ...Object.values(state.taskSessions).flatMap((runs) => runs.map((run) => run.sessionId))])
}

/** The tasks whose chat may still be opened: those the state reads, closed ones too, and every one that had a session. */
export function knownTasks(state: { tasks: { id: string }[]; taskSessions: Record<string, unknown> }): Set<string> {
  return new Set([...state.tasks.map((task) => task.id), ...Object.keys(state.taskSessions)])
}

export function staleDrafts(saved: { id: string; savedAt: number }[], known: Set<string>, now: number): string[] {
  return saved.filter((draft) => !known.has(draft.id) && now - draft.savedAt > UNKNOWN_GRACE_MS).map((draft) => draft.id)
}

let opened: Promise<IDBDatabase> | null = null

/** The browser's IndexedDB keeps a `File` as it is, which `localStorage` cannot. */
function database(): Promise<IDBDatabase> {
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE, { keyPath: 'sessionId' })
      if (!db.objectStoreNames.contains(TASK_STORE)) db.createObjectStore(TASK_STORE, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('cannot open IndexedDB'))
  }).catch((error: unknown) => {
    opened = null
    throw error
  })
  return opened
}

async function within<T>(store: string, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database()
  return new Promise<T>((resolve, reject) => {
    const request = work(db.transaction(store, mode).objectStore(store))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

/**
 * The draft of a task's chat, `null` without one or where the browser keeps nothing (a private window may refuse).
 * Without a task draft, the one kept by `sessionId` before drafts went by task is moved to the task.
 */
export async function readDraft(key: string, task: string, sessionId: string): Promise<Draft | null> {
  try {
    const found = await within<TaskDraft | undefined>(TASK_STORE, 'readonly', (store) => store.get(key) as IDBRequest<TaskDraft | undefined>)
    if (found !== undefined) return { text: found.text, files: found.files }
    const old = await within<SessionDraft | undefined>(SESSION_STORE, 'readonly', (store) => store.get(sessionId) as IDBRequest<SessionDraft | undefined>)
    if (old === undefined) return null
    const draft = { text: old.text, files: old.files }
    await writeDraft(key, task, draft)
    await within(SESSION_STORE, 'readwrite', (store) => store.delete(sessionId))
    return draft
  } catch {
    return null
  }
}

/** Keeps the draft, or forgets it once it is blank — after a send too. */
export async function writeDraft(key: string, task: string, draft: Draft): Promise<void> {
  try {
    if (isBlank(draft)) await within(TASK_STORE, 'readwrite', (store) => store.delete(key))
    else await within(TASK_STORE, 'readwrite', (store) => store.put({ key, task, text: draft.text, files: draft.files, savedAt: Date.now() } satisfies TaskDraft))
  } catch {
    // Nowhere to keep it: the draft lives only while the window is open, as before.
  }
}

/** Forgets the drafts of tasks that are gone, and those still kept by a session that is gone. */
export async function pruneDrafts(tasks: Set<string>, sessions: Set<string>): Promise<void> {
  try {
    const now = Date.now()
    const byTask = await within<TaskDraft[]>(TASK_STORE, 'readonly', (store) => store.getAll() as IDBRequest<TaskDraft[]>)
    const live = new Set(byTask.filter((draft) => tasks.has(draft.task)).map((draft) => draft.key))
    for (const key of staleDrafts(byTask.map((draft) => ({ id: draft.key, savedAt: draft.savedAt })), live, now))
      await within(TASK_STORE, 'readwrite', (store) => store.delete(key))
    const bySession = await within<SessionDraft[]>(SESSION_STORE, 'readonly', (store) => store.getAll() as IDBRequest<SessionDraft[]>)
    for (const sessionId of staleDrafts(bySession.map((draft) => ({ id: draft.sessionId, savedAt: draft.savedAt })), sessions, now))
      await within(SESSION_STORE, 'readwrite', (store) => store.delete(sessionId))
  } catch {
    // The same as a draft that cannot be written.
  }
}
