import type { CiKind } from '../ci/model.js'
import { FORGES } from './en-values.js'

const NOTE_REFUSALS = {
  outside: 'the file is outside the task folder',
  secret: '.env files (except .env.example) and .git cannot be published',
  missing: 'the file or task folder is missing',
  notFile: 'the path is not a regular file',
  tooLarge: 'the file exceeds the description size limit',
  empty: 'the description is empty',
  unreadable: 'the file could not be read',
}

export type NoteRefusal = keyof typeof NOTE_REFUSALS

export const REVIEW_NOTICES = {
  'review.denied': (p: { ci: string; status: number }) => `${p.ci}: the token was refused (HTTP ${p.status}); it needs to write pull requests of the repository`,
  /** `note` is of notices stored before BTN-1149: the advice now gives way to the cause's own (`en-advice.ts`). */
  'review.notOpened': (p: { task: string; note?: boolean }) => `the pull request of ${p.task} was not opened`,
  'review.notCompleted': (p: { task: string }) => `${p.task} has nothing to open as a pull request, but it was not moved to done in the tracker`,
  'review.notReady': (p: { project: string }) =>
    `PR mode of ${p.project} has nowhere to open pull requests, so its chain starts no task; it goes on by itself within a minute once that is fixed, or turn PR mode off`,
  'review.cannotEnable': (p: { project: string }) => `PR mode of ${p.project} is not turned on`,
  'review.noRemote': (p: { project: string }) => `${p.project} has no remote on GitHub, GitLab or Forgejo to open a pull request on`,
  'review.noToken': (p: { remote: string; kind: CiKind; web: string }) =>
    `no profile has a token for the remote ${p.remote} (${p.web}); add a ${FORGES[p.kind]} profile for its host`,
  'review.unsupportedHost': (p: { remote: string; host: string }) => `the remote ${p.remote} on ${p.host} is not supported for pull requests: only GitHub, GitLab and Forgejo are`,
  /** `path` is as the page shows it, relative to the task folder where it lies there; `full` is the whole path, for a tip and the log. */
  'review.noNote': (p: { path: string; reason?: NoteRefusal; limit?: number; full?: string }) => p.reason === undefined
    ? `the session left no pull request description at ${p.path}`
    : `PR description ${p.path} refused: ${NOTE_REFUSALS[p.reason]}${p.reason === 'tooLarge' ? ` (${p.limit} bytes)` : ''}`,
  'review.noBranch': (p: { path: string }) => `${p.path} is not on a branch`,
  'review.dirty': (p: { path: string }) => `${p.path} has uncommitted changes`,
  'review.nothingAhead': (p: { branch: string; base: string }) => `${p.branch} has no commits beyond ${p.base}`,
  'review.pushFailed': (p: { branch: string; remote: string }) => `could not push ${p.branch} to ${p.remote}`,
  'review.pushBehind': (p: { branch: string; remote: string }) =>
    `${p.branch} on ${p.remote} has commits the session's branch lacks (a conflict resolved on the forge, say): the session is to merge them and mark the pull request again`,
}
