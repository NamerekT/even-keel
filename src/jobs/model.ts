import type { CloneProgress } from '../git/clone-progress.js'
import type { Notice } from '../notice/notice.js'

export type StepState = 'waiting' | 'running' | 'done' | 'failed'

export interface JobStep {
  id: string
  state: StepState
  /** Where a step that reports it is: a clone's stage, percent, bytes and speed. */
  progress?: CloneProgress
}

/**
 * A piece of work the service does in steps while a window of the page shows them (BTN-1048): creating a project, and
 * later adding a machine to one. The page names the kind and the steps; the service only says their state.
 */
export interface StepJob {
  id: string
  kind: string
  /** What is being made, as the window's head names it: the project's folder. */
  subject: string
  /** The steps in order; one that only some runs have (the LFS files of a clone) is absent until it starts. */
  steps: JobStep[]
  /** Why the step marked `failed` failed; "Retry" runs it again. */
  failure: Notice | null
  done: boolean
  /** Cancel still undoes what was made; `false` once the work cannot be taken back. */
  undoable: boolean
  /** What a finished job made: a project's id. */
  result?: string
}
