import { join } from 'node:path'
import { fail, notice, type Notice } from '../notice/notice.js'
import type { FinishOutcome, Git, TaskPlace } from './types.js'
import { dropBranch, finishWorktree, hasBranch, must, taskPlace, worktreesAt, type BranchDrop } from './worktree.js'

export interface SlotUse {
  idle: boolean
  busy: string[]
}

export interface SlotPool {
  count: number
  occupancy: (path: string) => SlotUse
  vacate: (path: string) => Promise<void>
  /** The project's main branch: a new slot and a new task branch start from it. */
  main: string
  /** The slot is taken before the launch: as in `prepareWorktree`, a task without a branch gets it only at the launch. */
  ahead: boolean
  /** The slot taken ahead for the task: while it is still detached, it is the task's, dirty or not. */
  at: string
  /**
   * How many slots the task may already be in: the pool shrunk on the fly keeps its busy slots past `count` until they
   * are free. A free slot is chosen only within `count`.
   */
  span: number
}

export function slotPaths(repo: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => join(repo, '.claude', 'worktrees', index === 0 ? 'even-keel' : `even-keel-${index + 1}`))
}

/** The slot among the first `span` that is on the task's branch; `undefined` — none. */
export async function heldSlot(git: Git, repo: string, task: string, span: number): Promise<TaskPlace | undefined> {
  const paths = slotPaths(repo, span)
  const slots = await worktreesAt(git, repo, paths)
  const holding = slots.findIndex((slot) => isTaskBranch(slot?.branch ?? null, task))
  return holding === -1 ? undefined : { path: paths[holding]!, branch: slots[holding]!.branch! }
}

export async function prepareSlot(git: Git, repo: string, task: string, options: Partial<SlotPool> = {}): Promise<TaskPlace> {
  const { count = 1, occupancy = () => ({ idle: false, busy: [] }), vacate = async () => {}, main = 'main', at } = options
  const place = taskPlace(repo, task)
  const paths = slotPaths(repo, Math.max(count, options.span ?? count))
  const [own, ...slots] = await worktreesAt(git, repo, [place.path, ...paths])
  if (own !== undefined) return { path: place.path, branch: own.branch }
  const holding = slots.findIndex((slot) => isTaskBranch(slot?.branch ?? null, task))
  if (holding !== -1) return { path: paths[holding]!, branch: slots[holding]!.branch! }
  const branched = await hasBranch(git, repo, place.branch)
  const detached = options.ahead === true && !branched

  const taken = at === undefined ? -1 : paths.indexOf(at)
  if (taken !== -1 && slots[taken] !== undefined && slots[taken].branch === null) {
    if (detached) return { path: at!, branch: null }
    await must(git, at!, ['switch', ...(branched ? [] : ['-c']), place.branch], 'switch', place.branch)
    return { path: at!, branch: place.branch }
  }

  const free: { path: string; rank: number }[] = []
  const refusals: Notice[] = []
  for (const [index, slot] of slots.entries()) {
    if (index >= count) break
    const path = paths[index]!
    if (slot === undefined) {
      free.push({ path, rank: 2 })
      continue
    }
    const status = await must(git, path, ['status', '--porcelain'], 'readStatus')
    if (status.out !== '') {
      refusals.push(notice('slot.dirty', { path }, { detail: status.out }))
      continue
    }
    const use = occupancy(path)
    if (use.busy.length > 0) {
      refusals.push(notice('slot.busy', { path, sessions: use.busy }))
      continue
    }
    free.push({ path, rank: use.idle ? 3 : slot.branch === null ? 0 : 1 })
  }
  const chosen = free.sort((a, b) => a.rank - b.rank)[0]
  if (chosen === undefined) throw fail('slot.noneFree', { task }, { items: refusals })

  if (chosen.rank === 2) await must(git, repo, ['worktree', 'add', '--detach', chosen.path, main], 'addSlot')
  else await vacate(chosen.path)
  await must(git, chosen.path, ['clean', '-fd'], 'clean')
  if (detached) {
    if ((slots[paths.indexOf(chosen.path)]?.branch ?? null) !== null) await must(git, chosen.path, ['switch', '--detach', main], 'switch', main)
    return { path: chosen.path, branch: null }
  }
  const args = branched ? ['switch', place.branch] : ['switch', '-c', place.branch, main]
  await must(git, chosen.path, args, 'switch', place.branch)
  return { path: chosen.path, branch: place.branch }
}

export async function finishSlot(git: Git, repo: string, task: string, count = 1, main = 'main', drop: BranchDrop = {}): Promise<FinishOutcome> {
  const place = taskPlace(repo, task)
  const paths = slotPaths(repo, count)
  const [own, ...slots] = await worktreesAt(git, repo, [place.path, ...paths])
  if (own !== undefined) return finishWorktree(git, repo, task, main, drop)

  const holding = slots.findIndex((slot) => isTaskBranch(slot?.branch ?? null, task))
  if (holding === -1) return dropBranch(git, repo, (await hasBranch(git, repo, place.branch)) ? place.branch : null, [], main, drop)
  const path = paths[holding]!
  const branch = slots[holding]!.branch!
  const kept = await leaveBranch(git, path, branch, main)
  if (kept === null) return dropBranch(git, repo, branch, [], main, drop)
  return dropBranch(git, repo, null, [kept], main, drop)
}

async function leaveBranch(git: Git, path: string, branch: string, main: string): Promise<Notice | null> {
  const status = await git(path, ['status', '--porcelain'])
  if (status.code !== 0) return notice('cleanup.slotKept', { path, branch }, { detail: status.out })
  if (status.out.trim() !== '') return notice('cleanup.slotDirty', { path, branch }, { detail: status.out })
  const switched = await git(path, ['switch', '--detach', main])
  return switched.code === 0 ? null : notice('cleanup.slotKept', { path, branch }, { detail: switched.out })
}

function isTaskBranch(branch: string | null, task: string): branch is string {
  return branch !== null && branch.startsWith(`${task.toLowerCase()}/`)
}
