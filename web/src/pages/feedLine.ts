import type { FeedLine } from '../../../src/sessions/transcript.js'
import { say } from '../i18n/index.js'

/** The last part of a path, by either separator. */
export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** A line of the activity feed in its parts: an answer's answers and the user's words a line each, then the names of the files they sent. */
export function feedParts(line: FeedLine): { lines: string[]; files: string[] } {
  const answers = Object.entries(line.answers?.answers ?? {}).map(([question, answer]) => `${question} → ${answer}`)
  const text = line.notice === undefined ? line.text : say(line.notice)
  return { lines: [...answers, text].filter((part) => part !== ''), files: (line.files ?? []).map(fileName) }
}
