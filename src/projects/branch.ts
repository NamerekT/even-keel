/**
 * The project's main branch and the main checkout as one thing (BTN-754): the field offers the repository's branches,
 * and a new value moves the checkout. Pure — the page reads the same move to say what saving will do.
 */

/** A branch the main branch field offers. */
export interface BranchChoice {
  name: string
  /** The remote it is only on, the checkout would take it from there; `null` — a local branch. */
  remote: string | null
}

/** The main checkout's branches as the field offers them. */
export interface RepoBranches {
  /** The branch the checkout stands on; `null` — detached HEAD. */
  current: string | null
  /** The short sha of HEAD, which a new branch starts from; `null` — no commit yet. */
  head: string | null
  /** The current branch first, then the other local ones, then those only on a remote. */
  branches: BranchChoice[]
}

/** What the checkout does once the field's value is saved. */
export type BranchMove =
  | { kind: 'stay' }
  | { kind: 'switch'; from: string | null }
  | { kind: 'create'; from: string | null; head: string | null }
  | { kind: 'track'; remote: string; from: string | null }

export function branchMove(repo: RepoBranches, target: string): BranchMove {
  const name = target.trim()
  if (name === repo.current) return { kind: 'stay' }
  const found = repo.branches.find((branch) => branch.name === name)
  if (found === undefined) return { kind: 'create', from: repo.current, head: repo.head }
  return found.remote === null ? { kind: 'switch', from: repo.current } : { kind: 'track', remote: found.remote, from: repo.current }
}

/** Where the main checkout stands when it is not on the project's branch (`EvenKeelState.branchDrift`). */
export interface BranchDrift {
  /** The project's main branch, the `branch` key. */
  branch: string
  /** The branch of the checkout; `null` — detached HEAD. */
  current: string | null
}
