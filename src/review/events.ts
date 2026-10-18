import type { Feedback, PullRequest, ReviewCheck, ReviewOutcome } from './model.js'

/** The key an event is remembered by in `PullRequest.seen`. */
export function eventKey(item: Feedback): string {
  if (item.kind === 'changes') return `review:${item.request.id}`
  if (item.kind === 'ci') return `ci:${item.run.id}`
  return `conflict:${item.head}`
}

/**
 * What a poll of the pull request asks of the chain: a close, merged or not, or the events the session has not been
 * told of — reviews of changes after the last push, failed runs of the head commit, a conflict with main.
 */
export function outcomeOf(pull: PullRequest, check: ReviewCheck): ReviewOutcome {
  const { state } = check
  if (state.state === 'merged') return { kind: 'merged' }
  if (state.state === 'closed') return { kind: 'closed' }
  const pushed = Date.parse(pull.pushedAt)
  const items: Feedback[] = [
    ...check.changes.filter((request) => Date.parse(request.at) > pushed).map((request): Feedback => ({ kind: 'changes', request })),
    ...check.failed.filter((run) => run.commit === state.head && run.status === 'failure').map((run): Feedback => ({ kind: 'ci', run })),
    ...(state.mergeable === false ? [{ kind: 'conflict', head: state.head } as const] : []),
  ].filter((item) => !pull.seen.includes(eventKey(item)))
  return items.length === 0 ? { kind: 'none' } : { kind: 'feedback', items }
}
