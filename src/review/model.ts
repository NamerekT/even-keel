import type { CiKind, CiRun } from '../ci/model.js'

/**
 * A task's pull request that Even Keel opened in PR mode (BTN-205), kept in the chain state until it is closed and
 * cleaned up after. While it is open without feedback, the task is out of the chain and blocks its dependants.
 */
export interface PullRequest {
  task: string
  /** The git remote the branch is pushed to and the pull request is on. */
  remote: string
  number: number
  url: string
  branch: string
  /** When Even Keel opened it. */
  at: string
  /** When Even Keel last pushed the branch: a review of changes counts only after it. */
  pushedAt: string
  /** The `lastReplyAt` of the session's response that set the last mark acted on: the same mark is not acted on twice. */
  markAt: string | null
  /** The events already acted on (`eventKey`): each one reaches the session once. */
  seen: string[]
  /** What the reviewers, the CI or the conflict with main ask of the session, not delivered yet. */
  feedback?: string
  /** Closed on the forge; its cleanup is still due. */
  closed?: 'merged' | 'unmerged'
  /** Closed unmerged: what the task's next launch is told of it — its link and its remarks (BTN-223). */
  closedNote?: string
  /** Closed unmerged and cleaned up after: the record stays only for `closedNote`, until the task launches or is done. */
  cleaned?: true
  /** The chain ended by itself while it was open: feedback on it starts the chain again (BTN-375). Stop clears it. */
  wakes?: true
}

/** The pull request as the forge has it now. */
export interface PullState {
  state: 'open' | 'merged' | 'closed'
  /** `null` — the forge has not computed it yet. */
  mergeable: boolean | null
  head: string
}

export interface ReviewComment {
  path: string
  line: number | null
  body: string
}

/**
 * What someone said on the pull request: a review that asks for changes, a review that only comments, or a comment in
 * its conversation (BTN-223). The pull request's author cannot ask for changes on it, so a user who opened it with their
 * own token gives feedback by commenting.
 */
export interface Remark {
  /** The key it is remembered by in `PullRequest.seen`: `review:<id>` or `comment:<id>`. */
  key: string
  kind: 'changes' | 'review' | 'comment'
  author: string
  body: string
  at: string
  comments: ReviewComment[]
}

/** What `Forge.find` and `Forge.create` give of a pull request. */
export interface PullRef {
  number: number
  url: string
}

/** A pull request opened or found for the branch Even Keel has just pushed. */
export interface Opened extends PullRef {
  branch: string
  pushedAt: string
}

export interface NewPull {
  branch: string
  base: string
  title: string
  body: string
}

/** The pull requests of a repository on GitHub or Forgejo, or the merge requests of a GitLab project, as far as PR mode needs them. */
export interface Forge {
  kind: CiKind
  /** The open pull request of the branch; `null` — none. */
  find(branch: string): Promise<PullRef | null>
  create(pull: NewPull): Promise<PullRef>
  state(number: number): Promise<PullState>
  /**
   * The remarks made since `since` that `wanted` takes by key and time, oldest first: reviews that ask for changes or
   * comment, with their line comments, and the comments of the conversation. An approval, a review without a word and
   * a bot's comment in the conversation are not remarks.
   */
  remarks(number: number, since: string, wanted: (key: string, at: string) => boolean): Promise<Remark[]>
}

/**
 * What a poll of an open pull request found. `remarks` — the new ones after the last push; for a pull request closed
 * unmerged, every one since it was opened.
 */
export interface ReviewCheck {
  state: PullState
  remarks: Remark[]
  /** The failed CI runs on the head commit. */
  failed: CiRun[]
}

export type Feedback = { kind: 'remark'; remark: Remark } | { kind: 'ci'; run: CiRun } | { kind: 'conflict'; head: string }

export type ReviewOutcome = { kind: 'merged' } | { kind: 'closed'; remarks: Remark[] } | { kind: 'feedback'; items: Feedback[] } | { kind: 'none' }

/** Whether a review says something: one asking for changes always does, one that comments needs words or line comments. */
export function said(remark: Remark): boolean {
  return remark.kind === 'changes' || remark.body.trim() !== '' || remark.comments.length > 0
}

/**
 * The mark a session puts into what it writes on its own pull request (BTN-442): it often posts with the same token
 * as Even Keel, so the author does not tell its words from a reviewer's. A forge hides it when it renders the text.
 */
export const SESSION_MARK = '<!-- even-keel:session -->'

/** The remarks without the session's own words: a marked remark goes whole, a marked line comment goes alone. */
export function othersOnly(remarks: Remark[]): Remark[] {
  return remarks.flatMap((remark) => {
    if (remark.body.includes(SESSION_MARK)) return []
    const comments = remark.comments.filter((comment) => !comment.body.includes(SESSION_MARK))
    if (comments.length === remark.comments.length) return [remark]
    const left = { ...remark, comments }
    return said(left) ? [left] : []
  })
}

/** The remarks of a list sorted oldest first. */
export function byTime(remarks: Remark[]): Remark[] {
  return [...remarks].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}
