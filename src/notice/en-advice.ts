import type { NoticeAdvice } from './notice.js'

/**
 * What to do about a message, apart from what happened (BTN-1149): a chain of causes shows one advice, the deepest
 * notice's that has one, so a wrapper's is only for a cause without its own. A code not here says it all in its text.
 */
export const ADVICE = {
  'chain.unchangedNotChecked': () => 'answer its session from the chat, or skip the task',
  'chain.unchangedNotCompleted': () => 'move it there yourself and resume the chain, or skip the task',
  'review.notOpened': () => 'fix access and press Resume, answer its session from the chat, or skip the task',
  'review.notCompleted': () => 'move it there yourself and resume the chain, or skip the task',
  'review.noNote': (p) => (p.reason === undefined ? undefined : 'write a safe note in the task folder, mark again and press Resume'),
} satisfies NoticeAdvice
