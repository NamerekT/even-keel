/**
 * A clone's remote branches for the wizard's branch field (BTN-1096). Pure: the service and the fake page share it.
 * A remote may have thousands of branches, and the wizard checks its draft on every key: past `REMOTE_OFFERED` the
 * answer carries only those that fit the typed branch.
 */

/** The most branches one answer of the check carries. */
export const REMOTE_OFFERED = 200

/** What the branch field of a clone offers. */
export interface RemoteBranchList {
  /** The remote's default branch, the one a clone takes when the field names none; `null` — an empty repository. */
  head: string | null
  /** The default first, then the typed one, then the rest in the remote's order; task branches `<slug>/task` left out. */
  branches: string[]
  /** The remote's branches in all, task branches left out: more than `branches` holds — the list is narrowed. */
  total: number
  /** The branch typed when the list was made, which `has` answers for. */
  typed: string
  /** `typed` is a branch of the remote: the clone takes it, else it takes the default and `typed` is created. */
  has: boolean
}

const isTaskBranch = (name: string) => name.endsWith('/task')

/** The remote's branches as the field offers them, narrowed by the typed branch when there are too many. */
export function remoteOffer(heads: { head: string | null; branches: readonly string[] }, typed: string): RemoteBranchList {
  const wanted = typed.trim()
  const offered = heads.branches.filter((name) => !isTaskBranch(name))
  const words = wanted.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const fits = (name: string) => offered.length <= REMOTE_OFFERED || words.every((word) => name.toLocaleLowerCase().includes(word))
  const first = [heads.head, wanted].filter((name): name is string => name !== null && name !== '' && offered.includes(name))
  const rest = offered.filter((name) => !first.includes(name) && fits(name))
  return {
    head: heads.head,
    branches: [...new Set(first)].concat(rest).slice(0, REMOTE_OFFERED),
    total: offered.length,
    typed: wanted,
    has: wanted !== '' && heads.branches.includes(wanted),
  }
}
