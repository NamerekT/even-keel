import type { FeedLine } from '../../../src/sessions/transcript.js'

/** The last part of a path, by either separator. */
export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** A line of the activity feed as one text: an answer's answers, the user's words and the files they sent. */
export function feedText(line: FeedLine): string {
  const answers = Object.entries(line.answers?.answers ?? {}).map(([question, answer]) => `${question} → ${answer}`)
  const files = (line.files ?? []).map((file) => `📎 ${fileName(file)}`)
  return [...answers, line.text, ...files].filter((part) => part !== '').join(' · ')
}
