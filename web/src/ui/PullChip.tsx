import type { ReviewView } from '../../../src/chain/dispatcher.js'
import { t } from '../i18n/index.js'
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
