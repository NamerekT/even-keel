import { PROMPTS } from '../chain/prompts.js'
import type { Language } from '../language.js'
import type { Feedback, Remark } from './model.js'

/** The remarks of a pull request closed unmerged told to the task's next session in full; earlier ones are counted. */
const CLOSED_REMARKS = 20

/** What the session is told of the feedback on its pull request: each remark with its line comments, the failed runs, the conflict. */
export function feedbackText(url: string, items: Feedback[], language: Language, main: string): string {
  const text = PROMPTS[language].review
  const lines = [text.head(url)]
  for (const item of items) {
    if (item.kind === 'remark') lines.push(...remarkLines(item.remark, language))
    else if (item.kind === 'ci') lines.push(text.ci(item.run.title.trim() || item.run.workflow, item.run.url))
    else lines.push(text.conflict(main))
  }
  return lines.join('\n')
}

/**
 * What the task's next session is told of its pull request closed unmerged (BTN-223): the link and the remarks made on
 * it, the latest ones when there are many.
 */
export function closedText(url: string, remarks: Remark[], language: Language, main: string): string {
  const text = PROMPTS[language].review
  const told = remarks.slice(-CLOSED_REMARKS)
  const lines = [text.closed(url)]
  if (remarks.length > told.length) lines.push(text.earlier(remarks.length - told.length))
  for (const remark of told) lines.push(...remarkLines(remark, language))
  if (remarks.length === 0) lines.push(text.noRemarks)
  return [lines.join('\n'), text.closedAfter(main)].join('\n\n')
}

/** The feedback of several polls the session has not got yet, as one message. */
export function withFeedback(before: string | undefined, text: string, language: Language): string {
  const after = PROMPTS[language].review.after
  const kept = before?.endsWith(after) ? before.slice(0, -after.length).trimEnd() : before
  return [kept, text, after].filter((part) => part !== undefined && part !== '').join('\n\n')
}

function remarkLines(remark: Remark, language: Language): string[] {
  const text = PROMPTS[language].review
  const { kind, author, body, comments } = remark
  const by = author.trim() || '?'
  const lines = [kind === 'changes' ? text.changes(by) : kind === 'review' ? text.reviewed(by) : text.talk(by)]
  if (body.trim() !== '') lines.push(indented(body, '  '))
  for (const comment of comments) lines.push(text.comment(comment.path, comment.line), indented(comment.body, '    '))
  return lines
}

function indented(text: string, by: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => by + line)
    .join('\n')
}
