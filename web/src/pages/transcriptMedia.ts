import type { FeedLine } from '../../../src/sessions/transcript.js'
import { fileName } from './feedLine.js'
import type { Media } from './MediaViewer.js'

/** The pictures the service gives for a sent file (`inboxImage`); any other file stays a name. */
const SENT_IMAGE = /\.(png|jpe?g|gif|webp)$/i
const SHARED_MARKDOWN = /\.(md|markdown)$/i

/** Whether a file the user sends is a picture the chat shows. */
export const isSentPicture = (name: string): boolean => SENT_IMAGE.test(name)

export interface MediaUrls {
  image(tool: string, index: number): string
  file(name: string): string
  /** File `index` a session sent the user by call `tool`. */
  shared(tool: string, index: number): string
  /** The browser's own address of a picture the user just sent, by its name (an object URL of the chosen file). */
  local?(name: string): string | undefined
}

export interface TranscriptMedia {
  /** Every picture of the transcript in its order: what tool results held, what the user sent and what the session sent. */
  items: Media[]
  /**
   * The name of each item, what it shows rather than where it stands: a sent picture by its file's name from the send to
   * the agent's read, the rest by the call; a repeated name gets `#2`, `#3` in its order. The viewer holds one by it.
   */
  keys: string[]
  /** The places in `items` of each call's pictures, by the call's id. */
  byTool: Map<string, number[]>
  /** The place in `items` of each picture the user sent, by its path. */
  byFile: Map<string, number>
  /** The place in `items` of each picture a session sent the user, by `<call id>/<index of the file>`. */
  byShare: Map<string, number>
}

/** How the chat shows a file a session sent the user: markdown rendered, a picture as a thumbnail, the rest to download. */
export function sharedKind(path: string): 'markdown' | 'image' | 'file' {
  return SHARED_MARKDOWN.test(path) ? 'markdown' : SENT_IMAGE.test(path) ? 'image' : 'file'
}

const INBOX = '/.temp/inbox/'

const normalPath = (path: string): string => path.replaceAll('\\', '/').toLowerCase()
const isFullPath = (path: string): boolean => /^(?:[a-z]:)?\//i.test(path.replaceAll('\\', '/'))

/**
 * Whether two names of a picture the user sent are one file: by the full path where both know it, else by the name.
 * A read in another folder's inbox — a worktree of another task — is another file.
 */
function sameSent(a: string, b: string): boolean {
  if (isFullPath(a) && isFullPath(b)) return normalPath(a) === normalPath(b)
  return fileName(a).toLowerCase() === fileName(b).toLowerCase()
}

/**
 * The file a single-picture result of a call shows, when it may be one the user sent: in `.temp/inbox/` or known only
 * by its name. The image line of Claude has only the name, so its tool line's subject gives the full path.
 */
function readPicture(line: FeedLine, subjects: Map<string, string>): string | null {
  if (line.images !== 1) return null
  const path = [line.text, subjects.get(line.tool!) ?? ''].find(isFullPath) ?? line.text
  if (!SENT_IMAGE.test(path)) return null
  return !isFullPath(path) || normalPath(path).includes(INBOX) ? path : null
}

/**
 * `fallback` names a picture of a call that is not a `Read`, when the transcript has no tool line for it.
 *
 * A picture the user sent and the agent's read of it are one frame (BTN-1361): it stands where it first shows, and once
 * the agent read it, its address is the transcript's copy, which outlives the inbox file the worktree's cleanup takes.
 */
export function transcriptMedia(lines: FeedLine[], urls: MediaUrls, fallback: string): TranscriptMedia {
  const items: Media[] = []
  const keys: string[] = []
  const add = (item: Media, key: string): number => {
    keys.push(keys.includes(key) ? `${key}#${keys.filter((each) => each === key || each.startsWith(`${key}#`)).length + 1}` : key)
    return items.push(item) - 1
  }
  const byTool = new Map<string, number[]>()
  const byFile = new Map<string, number>()
  const byShare = new Map<string, number>()
  const toolTexts = new Map(lines.flatMap((line) => (line.kind === 'tool' && line.tool !== undefined ? [[line.tool, line.text]] : [])))
  const subjects = new Map(lines.flatMap((line) => (line.kind === 'tool' && line.tool !== undefined && line.subject !== undefined ? [[line.tool, line.subject]] : [])))
  const reads = lines.flatMap((line) => {
    const path = line.kind === 'image' && line.tool !== undefined ? readPicture(line, subjects) : null
    return path === null ? [] : [{ tool: line.tool!, path }]
  })
  // Each frame of a sent picture, by the file it shows; a read joins a sent one, a sent one joins only a read.
  const frames: { place: number; path: string; read: boolean }[] = []
  for (const line of lines) {
    if (line.kind === 'image' && line.tool !== undefined) {
      const path = readPicture(line, subjects)
      const frame = path === null ? undefined : frames.find((each) => sameSent(each.path, path))
      if (frame !== undefined) byTool.set(line.tool, [frame.place])
      else {
        const name = line.text || toolTexts.get(line.tool) || fallback
        const places = Array.from({ length: line.images ?? 0 }, (_, index) => add({ kind: 'image', name, url: urls.image(line.tool!, index) }, path === null ? `tool:${line.tool}/${index}` : sentKey(fileName(path))))
        if (path !== null) frames.push({ place: places[0]!, path, read: true })
        byTool.set(line.tool, places)
      }
    }
    for (const file of line.files ?? []) {
      if (!SENT_IMAGE.test(file) || byFile.has(file)) continue
      const frame = frames.find((each) => each.read && sameSent(each.path, file))
      if (frame !== undefined) {
        byFile.set(file, frame.place)
        continue
      }
      const name = fileName(file)
      const read = reads.find((each) => sameSent(each.path, file))
      const local = urls.local?.(name)
      // The browser's copy wins at every stage: the same bytes under a new address would load again and blink (BTN-1425).
      const item: Media = local !== undefined
        ? { kind: 'image', name, url: local }
        : read !== undefined
          ? { kind: 'image', name, url: urls.image(read.tool, 0) }
          : { kind: 'image', name, url: urls.file(name), inbox: true }
      const place = add(item, sentKey(name))
      frames.push({ place, path: file, read: false })
      byFile.set(file, place)
    }
    if (line.share !== undefined && line.tool !== undefined) {
      line.share.files.forEach((file, index) => {
        if (sharedKind(file) !== 'image') return
        byShare.set(`${line.tool}/${index}`, add({ kind: 'image', name: fileName(file), url: urls.shared(line.tool!, index) }, `share:${line.tool}/${index}`))
      })
    }
  }
  return { items, keys, byTool, byFile, byShare }
}

const sentKey = (name: string): string => `sent:${name.toLowerCase()}`
