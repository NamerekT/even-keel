import type { CloneProgress } from '../git/clone-progress.js'
import type { Notice } from '../notice/notice.js'

export type StepState = 'waiting' | 'running' | 'done' | 'failed'

export interface JobStep {
  id: string
  state: StepState
  /** Where a step that reports it is: a clone's stage, percent, bytes and speed. */
  progress?: CloneProgress
  /** When the step last began and, once done or failed, ended (ISO): the window counts the step's time (BTN-1099). */
  startedAt?: string
  endedAt?: string
  /** Why a step of a group failed while the job went on (BTN-1297): the window shows it under the step. */
  failure?: Notice
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
  /** The project an existing project's job works on (connecting a machine to it). */
  project?: string
}

/** The job of "Connect" in the window "Add a machine" (BTN-1263): one machine, several projects in turn. */
export const JOIN_KIND = 'machine-join'

/** A project of that job: a clone made on the machine or a folder already there; no folder — the hub's name in its root. */
export interface JoinRequest {
  project: string
  clone: boolean
  folder?: string
}

/** A step of a job over several projects is `<step>@<project>`: the window names the step and groups it by project. */
export function stepOf(id: string): { step: string; project?: string } {
  const at = id.lastIndexOf('@')
  return at === -1 ? { step: id } : { step: id.slice(0, at), project: id.slice(at + 1) }
}
