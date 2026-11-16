import { EditRefused, type TaskUpload } from '../tracker/editor.js'
import type { FileSink } from './downloads.js'
import { UPLOADS_PER_CALL, type SessionFiles } from './files.js'

/**
 * The files of a call between the machine's gateway and the tasks server of the hub (BTN-990): the folder is the
 * machine's, so the gateway reads what a call attaches and sends it in the request's `params._meta`, and the hub
 * sends back in the result's `_meta` what `task_read` downloaded, for the gateway to write.
 */
export const SESSION_META = 'even-keel/session'
export const FILES_META = 'even-keel/files'
/** The machine whose call the hub's link carried to the hub's gateway (`HubMcp.relay`): never taken from the machine. */
export const MACHINE_HEADER = 'x-even-keel-machine'

export interface SentFile {
  name: string
  type: string
  /** base64 */
  data: string
}

export interface SessionMeta {
  /** By the path as the call names it, trimmed. */
  attach: Record<string, SentFile>
  /** The session has a folder: `task_read` downloads its task's files. */
  downloads: boolean
  /** The session of the task that made the call, as the machine found it then (`handoff_write`, BTN-1046). */
  writer?: NoteWriter
}

/** Who wrote a handoff note: the machine names the task's live session when the call is made, not when it arrives. */
export interface NoteWriter {
  session: string
  branch: string | null
  /** ISO */
  at: string
}

export interface CarriedFile {
  /** What the line names in the text instead of a path, until the gateway writes the file. */
  token: string
  key: string
  name: string
  data: string
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The session part of a request's `params._meta`; `undefined` — the call came without one. */
export function sessionMetaOf(params: Record<string, unknown>): SessionMeta | undefined {
  const meta = isObject(params._meta) ? params._meta[SESSION_META] : undefined
  if (!isObject(meta)) return undefined
  const attach: Record<string, SentFile> = {}
  for (const [path, file] of Object.entries(isObject(meta.attach) ? meta.attach : {})) {
    if (isObject(file) && typeof file.name === 'string' && typeof file.type === 'string' && typeof file.data === 'string') attach[path] = { name: file.name, type: file.type, data: file.data }
  }
  const writer = isObject(meta.writer) ? meta.writer : undefined
  const named = writer !== undefined && typeof writer.session === 'string' && typeof writer.at === 'string'
  return {
    attach,
    downloads: meta.downloads === true,
    ...(named ? { writer: { session: writer.session as string, branch: typeof writer.branch === 'string' ? writer.branch : null, at: writer.at as string } } : {}),
  }
}

export function sentFile(upload: TaskUpload): SentFile {
  return { name: upload.name, type: upload.type, data: Buffer.from(upload.bytes).toString('base64') }
}

/** The session's files as the hub has them: the ones sent with the call, and the downloads kept for the answer in `carried`. */
export function sentFiles(meta: SessionMeta, carried: CarriedFile[]): SessionFiles {
  const downloads: FileSink = {
    existing: async () => null,
    put: async (key, name, bytes) => {
      const token = `<<even-keel-file:${carried.length + 1}>>`
      carried.push({ token, key, name, data: Buffer.from(bytes).toString('base64') })
      return token
    },
  }
  return {
    read: async (paths, limit) => {
      if (paths.length > UPLOADS_PER_CALL) throw new EditRefused(`attach at most ${UPLOADS_PER_CALL} files in one call`)
      return paths.map((named) => {
        const file = meta.attach[named.trim()]
        if (file === undefined) throw new EditRefused(`"${named}" was not sent with the call; attach it again`)
        const bytes = Buffer.from(file.data, 'base64')
        if (bytes.byteLength > limit) throw new EditRefused(`"${named}" is larger than the attachment limit`)
        return { name: file.name, type: file.type, bytes }
      })
    },
    downloads: meta.downloads ? downloads : null,
  }
}
