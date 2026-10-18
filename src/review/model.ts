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

/** A review that asks for changes. */
export interface ChangeRequest {
  id: string
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

export interface NewPull {
  branch: string
  base: string
  title: string
  body: string
}

/** The pull requests of a repository on GitHub or Forgejo, as far as PR mode needs them. */
export interface Forge {
  kind: CiKind
  /** The open pull request of the branch; `null` — none. */
  find(branch: string): Promise<PullRef | null>
  create(pull: NewPull): Promise<PullRef>
  state(number: number): Promise<PullState>
  /** The reviews that ask for changes and that `wanted` takes, with their comments, oldest first. */
  changes(number: number, wanted: (id: string, at: string) => boolean): Promise<ChangeRequest[]>
}

/** What a poll of an open pull request found. */
export interface ReviewCheck {
  state: PullState
  changes: ChangeRequest[]
  /** The failed CI runs on the head commit. */
  failed: CiRun[]
}

export type Feedback =
  | { kind: 'changes'; request: ChangeRequest }
  | { kind: 'ci'; run: CiRun }
  | { kind: 'conflict'; head: string }

export type ReviewOutcome = { kind: 'merged' } | { kind: 'closed' } | { kind: 'feedback'; items: Feedback[] } | { kind: 'none' }
