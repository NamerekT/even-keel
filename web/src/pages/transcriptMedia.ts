import type { FeedLine } from '../../../src/sessions/transcript.js'
import { fileName } from './feedLine.js'
import type { Media } from './MediaViewer.js'

/** The pictures the service gives for a sent file (`inboxImage`); any other file stays a name. */
const SENT_IMAGE = /\.(png|jpe?g|gif|webp)$/i

export interface MediaUrls {
  image(tool: string, index: number): string
  file(name: string): string
}

export interface TranscriptMedia {
  /** Every picture of the transcript in its order: what tool results held and what the user sent. */
  items: Media[]
  /** The places in `items` of each call's pictures, by the call's id. */
  byTool: Map<string, number[]>
  /** The place in `items` of each picture the user sent, by its path. */
  byFile: Map<string, number>
}

/** `fallback` names a picture of a call that is not a `Read`, when the transcript has no tool line for it. */
export function transcriptMedia(lines: FeedLine[], urls: MediaUrls, fallback: string): TranscriptMedia {
  const items: Media[] = []
  const byTool = new Map<string, number[]>()
  const byFile = new Map<string, number>()
  const toolTexts = new Map(lines.flatMap((line) => (line.kind === 'tool' && line.tool !== undefined ? [[line.tool, line.text]] : [])))
  for (const line of lines) {
    if (line.kind === 'image' && line.tool !== undefined) {
      const name = line.text || toolTexts.get(line.tool) || fallback
      const places = Array.from({ length: line.images ?? 0 }, (_, index) => items.push({ kind: 'image', name, url: urls.image(line.tool!, index) }) - 1)
      byTool.set(line.tool, places)
    }
    for (const file of line.files ?? []) {
      if (!SENT_IMAGE.test(file) || byFile.has(file)) continue
      byFile.set(file, items.push({ kind: 'image', name: fileName(file), url: urls.file(fileName(file)) }) - 1)
    }
  }
  return { items, byTool, byFile }
}
