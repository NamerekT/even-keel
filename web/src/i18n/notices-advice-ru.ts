import type { ADVICE } from '../../../src/notice/en-advice.js'
import type { NoticeAdvice } from '../../../src/notice/notice.js'

export const adviceRu = {
  'chain.unchangedNotChecked': () => 'ответьте сессии из чата или пропустите задачу',
  'chain.unchangedNotCompleted': () => 'переведите её сами и продолжите цепочку или пропустите задачу',
  'review.notOpened': () => 'исправьте доступ и нажмите «Снять с паузы», ответьте её сессии в чате или пропустите задачу',
  'review.notCompleted': () => 'переведите её сами и продолжите цепочку или пропустите задачу',
  'review.noNote': (p) => (p.reason === undefined ? undefined : 'запишите безопасную заметку в папке задачи, повторите метку и нажмите «Снять с паузы»'),
} satisfies Required<Pick<NoticeAdvice, keyof typeof ADVICE>>
