import type { TrackerComment } from './source.js'

/** The comments that come after the one with id `after`, in the given order; `[]` when it is not among them. */
export function commentsAfterId<T extends { id: string }>(comments: T[], after: string): T[] {
  const index = comments.findIndex((comment) => comment.id === after)
  return index < 0 ? [] : comments.slice(index + 1)
}

/**
 * The files a comment links to on the tracker's own upload host (`host`), each once: GitHub and Linear keep
 * uploaded files as links in the text. The name is the link text, else the last part of the address.
 */
export function linkedFiles(body: string, host: RegExp): TrackerComment['files'] {
  const named = new Map<string, string>()
  for (const [, text, url] of body.matchAll(/!?\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g)) if (text !== '' && !named.has(url!)) named.set(url!, text!)
  const files: TrackerComment['files'] = []
  const seen = new Set<string>()
  for (const [url] of body.matchAll(/https?:\/\/[^\s)"'<>\]]+/g)) {
    if (seen.has(url) || !host.test(url)) continue
    seen.add(url)
    files.push({ name: named.get(url) ?? decodeURIComponent(new URL(url).pathname.split('/').pop() || 'file'), file: url })
  }
  return files
}
