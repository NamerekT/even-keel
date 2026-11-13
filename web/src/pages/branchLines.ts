import { branchMove } from '../../../src/projects/branch.js'
import type { RemoteBranchList, RepoBranches } from '../../../src/state.js'
import { branchTexts } from '../i18n/branch.js'
import type { Offer } from '../ui/selectKeys.js'

/**
 * The main branch field's list (BTN-754): the checkout's branch first, marked so, then the local ones, then those only
 * on a remote; without the hidden ones, task branches and those other worktrees hold (BTN-765).
 */
export function branchOffers(repo: RepoBranches | null): Offer[] {
  if (repo === null) return []
  const texts = branchTexts()
  return repo.branches.filter((branch) => branch.hidden !== true).map((branch) => {
    const label = branch.name === repo.current ? texts.current : branch.remote === null ? undefined : texts.remote(branch.remote)
    return label === undefined ? { value: branch.name } : { value: branch.name, label }
  })
}

/** What saving the field does to the checkout, as a line under it; `null` — nothing: the checkout is on it, or it is blank. */
export function moveLine(repo: RepoBranches | null, value: string): string | null {
  const target = value.trim()
  if (repo === null || target === '') return null
  const move = branchMove(repo, target)
  const texts = branchTexts()
  if (move.kind === 'switch') return texts.switch(target, move.from)
  if (move.kind === 'create') return texts.create(target, move.from, move.head)
  if (move.kind === 'track') return texts.track(target, move.remote)
  return null
}

/** A clone's branch field list (BTN-1096): the remote's branches as the check sent them, the default marked so. */
export function remoteOffers(list: RemoteBranchList | undefined): Offer[] {
  if (list === undefined) return []
  const texts = branchTexts()
  return list.branches.map((name) => (name === list.head ? { value: name, label: texts.byDefault } : { value: name }))
}

/**
 * What a clone does with the typed branch, as a line under the field; `null` — blank, or not known yet: the check of a
 * narrowed list has not answered for the text typed since.
 */
export function cloneLine(list: RemoteBranchList | undefined, value: string): string | null {
  const target = value.trim()
  if (list === undefined || target === '') return null
  const full = list.branches.length >= list.total
  const has = target === list.typed ? list.has : full ? list.branches.includes(target) : null
  if (has === null) return null
  const texts = branchTexts()
  return has ? texts.cloned(target) : texts.clonedNew(target, list.head)
}
