import { PROMPTS } from '../chain/prompts.js'
import type { Language } from '../language.js'
import type { Feedback } from './model.js'

/** What the session is told of the feedback on its pull request: each review's words and comments, the failed runs, the conflict. */
export function feedbackText(url: string, items: Feedback[], language: Language, main: string): string {
  const text = PROMPTS[language].review
  const lines = [text.head(url)]
  for (const item of items) {
    if (item.kind === 'changes') {
      const { author, body, comments } = item.request
      lines.push(text.changes(author.trim() || '?'))
      if (body.trim() !== '') lines.push(indented(body, '  '))
      for (const comment of comments) lines.push(text.comment(comment.path, comment.line), indented(comment.body, '    '))
    } else if (item.kind === 'ci') lines.push(text.ci(item.run.title.trim() || item.run.workflow, item.run.url))
    else lines.push(text.conflict(main))
  }
  return lines.join('\n')
}

/** The feedback of several polls the session has not got yet, as one message. */
export function withFeedback(before: string | undefined, text: string, language: Language): string {
  const after = PROMPTS[language].review.after
  const kept = before?.endsWith(after) ? before.slice(0, -after.length).trimEnd() : before
  return [kept, text, after].filter((part) => part !== undefined && part !== '').join('\n\n')
}

function indented(text: string, by: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => by + line)
    .join('\n')
}
