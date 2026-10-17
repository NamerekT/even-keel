import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Entry } from './entry.js'

const TAIL_BYTES = 256 * 1024

/**
 * The chat's name as Claude Code shows it in its tab: the one the user gave (`custom-title`), else the generated one
 * (`ai-title`). The CLI appends both again every few turns, so the latest one is in the last lines.
 */
export function titleOf(text: string): string | null {
  let custom: string | null = null
  let generated: string | null = null
  for (const raw of text.split('\n')) {
    let entry: Entry | null
    try {
      entry = JSON.parse(raw) as Entry | null
    } catch {
      continue
    }
    if (typeof entry !== 'object' || entry === null) continue
    if (entry.type === 'custom-title' && typeof entry.customTitle === 'string' && entry.customTitle.trim() !== '') custom = entry.customTitle.trim()
    if (entry.type === 'ai-title' && typeof entry.aiTitle === 'string' && entry.aiTitle.trim() !== '') generated = entry.aiTitle.trim()
  }
  return custom ?? generated
}

/** Titles of live chats by session id: only the transcript's tail is read, and only once the file has grown. */
export class ChatTitles {
  private readonly known = new Map<string, { size: number; title: string | null }>()

  constructor(private readonly tailBytes = TAIL_BYTES) {}

  async of(projectsDir: string, sessionId: string): Promise<string | null> {
    const file = await findTranscript(projectsDir, `${sessionId}.jsonl`)
    if (file === undefined) return null
    const size = (await stat(file)).size
    const cached = this.known.get(sessionId)
    if (cached !== undefined && cached.size === size) return cached.title
    const title = titleOf(await readTail(file, size, this.tailBytes)) ?? cached?.title ?? null
    this.known.set(sessionId, { size, title })
    return title
  }
}

async function findTranscript(projectsDir: string, name: string): Promise<string | undefined> {
  for (const dir of await readdir(projectsDir).catch(() => [])) {
    const file = join(projectsDir, dir, name)
    if (await stat(file).then((info) => info.isFile(), () => false)) return file
  }
  return undefined
}

async function readTail(file: string, size: number, bytes: number): Promise<string> {
  const handle = await open(file, 'r')
  try {
    const length = Math.min(size, bytes)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    return buffer.toString('utf8')
  } finally {
    await handle.close()
  }
}
