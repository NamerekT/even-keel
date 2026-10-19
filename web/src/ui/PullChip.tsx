import type { ReviewView } from '../../../src/chain/dispatcher.js'
import { t } from '../i18n/index.js'
import { PullRequestIcon } from './icons.js'
import { Tipped } from './Tipped.js'

/** The pull request a task waits on: a link to it, and what came of it so far. */
export function PullChip({ review }: { review: ReviewView }) {
  return (
    <>
      <Tipped tip={t.chain.review.pullTitle} inline>
        <a href={review.url} className="chip chip--pull" target="_blank" rel="noreferrer" draggable={false}>
          {t.chain.review.pull(review.number)}
        </a>
      </Tipped>
      {review.feedback && (
        <Tipped tip={t.chain.review.feedbackTitle} inline focusable>
          <span className="chip chip--feedback">{t.chain.review.feedback}</span>
        </Tipped>
      )}
      {review.closed !== undefined && <span className="chip">{review.closed === 'merged' ? t.chain.review.merged : t.chain.review.closed}</span>}
    </>
  )
}

/**
 * The task's pull request opened in a new tab, beside the chat: a button with its number in the panel's actions,
 * `compact` — only the icon, for the head of the chat window.
 */
export function PullButton({ review, compact = false }: { review: ReviewView; compact?: boolean }) {
  const tip = (
    <>
      <span>{t.session.openPull(review.number)}</span>
      {review.feedback && <span>{t.chain.review.feedbackTitle}</span>}
      {review.closed !== undefined && <span>{review.closed === 'merged' ? t.chain.review.merged : t.chain.review.closed}</span>}
    </>
  )
  return (
    <Tipped tip={tip} inline align={compact ? 'end' : 'start'} className={compact ? 'pull-button pull-button--compact' : 'pull-button'}>
      <a
        href={review.url}
        className={compact ? 'panel__remote' : 'button pull-button__link'}
        target="_blank"
        rel="noreferrer"
        aria-label={compact ? t.session.openPull(review.number) : undefined}
      >
        <PullRequestIcon />
        {!compact && t.chain.review.pull(review.number)}
      </a>
    </Tipped>
  )
}
