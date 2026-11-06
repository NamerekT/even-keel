import { fail } from '../notice/notice.js'
import type { BranchChoice, BranchMove, RepoBranches } from '../projects/branch.js'
import { requireStarted } from './setup.js'
import type { Git } from './types.js'

/** The branch the checkout stands on; `null` — detached HEAD or not a repository. */
export async function currentBranch(git: Git, repo: string): Promise<string | null> {
  const head = await git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  return head.code === 0 && head.out.trim() !== '' ? head.out.trim() : null
}

/** The main checkout's branches for the main branch field (BTN-754); `null` when git cannot list them. */
export async function readBranches(git: Git, repo: string): Promise<RepoBranches | null> {
  const [current, head, refs, remotes] = await Promise.all([
    currentBranch(git, repo),
    git(repo, ['rev-parse', '--short', 'HEAD']),
    git(repo, ['for-each-ref', '--format=%(refname) %(worktreepath)', 'refs/heads/', 'refs/remotes/']),
    git(repo, ['remote']),
  ])
  if (refs.code !== 0) return null
  const names = remotes.code === 0 ? remotes.out.split(/\s+/).filter(Boolean) : []
  return { current, head: head.code === 0 && head.out.trim() !== '' ? head.out.trim() : null, branches: choicesOf(refs.out, names, current) }
}

/**
 * The local branches, the current one first, then the remote ones no local branch has, each name once. `refs` is
 * `for-each-ref` of `%(refname) %(worktreepath)`. A task's branch (`taskPlace`) and a branch some worktree other than
 * the checkout holds are marked hidden (BTN-765): never a main branch, and git would refuse the latter anyway.
 */
export function choicesOf(refs: string, remotes: string[], current: string | null): BranchChoice[] {
  const local: BranchChoice[] = []
  const remote: BranchChoice[] = []
  // A remote's name may hold a slash: the longest one that prefixes the ref is its remote.
  const byLength = [...remotes].sort((a, b) => b.length - a.length)
  for (const line of refs.split('\n').map((each) => each.trim())) {
    const gap = line.indexOf(' ')
    const ref = gap < 0 ? line : line.slice(0, gap)
    // The checkout holds only its current branch, so any other branch with a worktree path is another worktree's.
    const held = gap >= 0 && line.slice(gap + 1).trim() !== ''
    if (ref.startsWith('refs/heads/')) {
      const name = ref.slice('refs/heads/'.length)
      local.push(choice(name, null, name !== current && (held || isTaskBranch(name))))
    } else if (ref.startsWith('refs/remotes/')) {
      const rest = ref.slice('refs/remotes/'.length)
      const owner = byLength.find((name) => rest.startsWith(`${name}/`)) ?? rest.split('/')[0]!
      const name = rest.slice(owner.length + 1)
      if (name !== '' && name !== 'HEAD') remote.push(choice(name, owner, isTaskBranch(name)))
    }
  }
  const taken = new Set(local.map((each) => each.name))
  const only = remote.filter((each) => !taken.has(each.name) && (taken.add(each.name), true))
  const first = local.filter((each) => each.name === current)
  return [...first, ...local.filter((each) => each.name !== current), ...only]
}

function choice(name: string, remote: string | null, hidden: boolean): BranchChoice {
  return hidden ? { name, remote, hidden: true } : { name, remote }
}

/** Even Keel names a task's branch `<slug>/task` (`taskPlace`); a task key may itself hold a slash (`owner/repo#12`). */
function isTaskBranch(name: string): boolean {
  return name.endsWith('/task')
}

/** Whether git takes the name as a branch (`git check-ref-format --branch`). */
export async function isBranchName(git: Git, repo: string, name: string): Promise<boolean> {
  if (name.trim() === '' || name.startsWith('-')) return false
  return requireStarted(await git(repo, ['check-ref-format', '--branch', name])).code === 0
}

const TAKEN = /already (checked out|used by worktree) at/i
const DIRTY = /would be overwritten|commit your changes or stash them|conflict/i

/**
 * Moves the main checkout onto `branch` as `move` says. Git refuses on its own what it cannot carry: local changes that
 * conflict, a branch another worktree holds; then nothing has changed, and the refusal is said by its reason.
 */
export async function moveCheckout(git: Git, repo: string, branch: string, move: BranchMove): Promise<void> {
  if (move.kind === 'stay') return
  const args =
    move.kind === 'switch' ? ['switch', branch] : move.kind === 'create' ? ['switch', '-c', branch] : ['switch', '--track', `${move.remote}/${branch}`]
  const result = requireStarted(await git(repo, args))
  if (result.code === 0) {
    console.log(`git: ${repo} switched to ${branch} (git ${args.join(' ')})`)
    return
  }
  console.warn(`git: ${repo} did not switch to ${branch} (git ${args.join(' ')}): ${result.out}`)
  // Git's own words name the folders: they stay in the log, the page says the reason.
  if (TAKEN.test(result.out)) throw fail('branch.taken', { branch })
  if (DIRTY.test(result.out)) throw fail('branch.dirty', { branch, current: move.from })
  throw fail('branch.switchFailed', { branch, current: move.from })
}
