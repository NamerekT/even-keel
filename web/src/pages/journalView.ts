import type { TaskComment } from '../../../src/tracker/card.js'

/** How many of the latest entries a long journal shows before "N more". */
export const JOURNAL_SHOWN = 20

/** The entries in the order they were written, the oldest first; `hidden` — how many older ones stay folded. */
export function journalWindow(comments: TaskComment[], all: boolean): { shown: TaskComment[]; hidden: number } {
  const sorted = [...comments].sort((a, b) => a.at - b.at)
  const hidden = all ? 0 : Math.max(0, sorted.length - JOURNAL_SHOWN)
  return { shown: sorted.slice(hidden), hidden }
}

export interface AuthorTexts {
  you: string
  agent: string
  service: string
  noAuthor: string
}

/** The person reads their own notes as "You"; an agent is named by its model once the journal knows it. */
export function journalAuthor(comment: TaskComment, texts: AuthorTexts): string {
  const journal = comment.journal
  if (journal === undefined) return comment.author ?? texts.noAuthor
  if (journal.by === 'person') return texts.you
  if (journal.by === 'service') return texts.service
  return journal.model === null ? texts.agent : `${texts.agent} · ${journal.model}`
}
