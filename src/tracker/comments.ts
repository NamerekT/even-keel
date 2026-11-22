import type { TrackerComment } from './source.js'

/** The comments that come after the one with id `after`, in the given order; `[]` when it is not among them. */
export function commentsAfterId<T extends { id: string }>(comments: T[], after: string): T[] {
  const index = comments.findIndex((comment) => comment.id === after)
  return index < 0 ? [] : comments.slice(index + 1)
}

/**
 * The files a comment links to on the tracker's own upload host (`host`), each once: GitHub and Linear keep
 * uploaded files as links in the text. The name is the link text or an HTML picture's `alt`, else the last part of
 * the address.
 */
export function linkedFiles(body: string, host: RegExp): TrackerComment['files'] {
  const named = new Map<string, string>()
  const name = (url: string, text: string) => {
    if (text !== '' && !named.has(url)) named.set(url, text)
  }
  for (const [, text, url] of body.matchAll(/!?\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g)) name(url!, text!)
  for (const [tag] of body.matchAll(/<img\b[^>]*>/gi)) {
    const url = attribute(tag, 'src')
    const alt = attribute(tag, 'alt')
    if (url !== null && alt !== null) name(url, alt)
  }
  const files: TrackerComment['files'] = []
  const seen = new Set<string>()
  for (const [url] of body.matchAll(/https?:\/\/[^\s)"'<>\]]+/g)) {
    if (seen.has(url) || !host.test(url)) continue
    seen.add(url)
    files.push({ name: named.get(url) ?? decodeURIComponent(new URL(url).pathname.split('/').pop() || 'file'), file: url })
  }
  return files
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" }

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)
  if (match === null) return null
  return (match[1] ?? match[2]!).replace(/&(amp|lt|gt|quot|#39|apos);/g, (_, entity: string) => ENTITIES[entity]!).trim()
}
