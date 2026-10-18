import type { ProjectCheck, ProjectDraft } from '../../../src/state.js'

/** The wizard's fields as typed; `slots` counts only while the place is a pool of slots. */
export interface WizardFields {
  repo: string
  branch: string
  key: string
  name: string
  tracker: string
  trackerProject: string
  place: 'worktree' | 'slots'
  slots: string
}

export const EMPTY_FIELDS: WizardFields = { repo: '', branch: '', key: '', name: '', tracker: '', trackerProject: '', place: 'worktree', slots: '2' }

const KEY_LENGTH = 5

/** The draft the service checks and adds; `undefined` — the pool size is not a whole number above zero. */
export function draftOfFields(fields: WizardFields): ProjectDraft | undefined {
  let slot = 0
  if (fields.place === 'slots') {
    const text = fields.slots.trim()
    slot = /^\d+$/.test(text) ? Number(text) : 0
    if (slot < 1) return undefined
  }
  return {
    repo: fields.repo.trim(),
    branch: fields.branch.trim(),
    key: fields.key.trim(),
    name: fields.name.trim(),
    tracker: fields.tracker,
    trackerProject: fields.trackerProject.trim(),
    slot,
  }
}

/** The repository, the entry and the tracker passed; the trust is only a warning, it can be given after. */
export function readyToAdd(check: ProjectCheck | null): boolean {
  return check !== null && check.repo.root !== null && check.repo.notice === null && check.entry === null && check.tracker?.ok === true
}

/** A key suggested by the folder's name: the initials of its words, or the first letters of a single word. */
export function keyOfFolder(path: string): string {
  const folder = path.split(/[\\/]/).filter((part) => part !== '').pop() ?? ''
  const words = folder
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((word) => /^[A-Z]/.test(word))
  if (words.length === 0) return ''
  const key = words.length === 1 ? words[0]!.slice(0, 3) : words.map((word) => word[0]).join('')
  return key.slice(0, KEY_LENGTH)
}
