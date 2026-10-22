import type { ProjectCheck, ProjectDraft, TrackerChoice } from '../../../src/state.js'
import type { TrackerProject } from '../../../src/tracker/source.js'

/** The fields a suggestion fills while the user has not typed them. */
type Suggested = 'key' | 'name' | 'trackerProject'

/** The wizard's fields as typed; `slots` counts only while the place is a pool of slots. */
export interface WizardFields {
  repo: string
  branch: string
  key: string
  name: string
  tracker: string
  trackerProject: string
  /** The team a `within` tracker's project is in (Linear); the key defaults to it. */
  team: string
  /** The chosen tracker profile's id; blank — none chosen yet. */
  profile: string
  place: 'worktree' | 'slots'
  slots: string
  /** The fields typed by hand: a suggestion no longer overwrites them. */
  typed: Record<Suggested, boolean>
}

export const EMPTY_FIELDS: WizardFields = {
  repo: '',
  branch: '',
  key: '',
  name: '',
  tracker: '',
  trackerProject: '',
  team: '',
  profile: '',
  place: 'worktree',
  slots: '2',
  typed: { key: false, name: false, trackerProject: false },
}

/**
 * How a tracker names a project: `key` — by the project key itself (Huly: its identifier); `place` — by its own value,
 * the key is a free prefix (GitHub: `owner/name`); `within` — by a team (Linear), its value optionally narrowing it to a
 * project of the team, the key defaults to the team's and may differ (two projects of one team, BTN-73); `alias` — the
 * tracker's project is picked, the key defaults to its own and may differ (Huly: a second project of Even Keel on a
 * Huly project another one has).
 */
export type TrackerShape = 'key' | 'place' | 'within' | 'alias'

export function shapeOf(choice: TrackerChoice | undefined): TrackerShape {
  if (choice?.projectKey == null) return 'key'
  if (choice.projectKey.alias) return 'alias'
  return choice.projectKey.optional ? 'within' : 'place'
}

/** Whether the wizard shows the key as a field of its own, not only what the picked project fills. */
export const keyTyped = (shape: TrackerShape) => shape !== 'key'

/** The prefix the project's task ids will have where they are the tracker's own; blank — the key's. */
export function idPrefix(shape: TrackerShape, fields: WizardFields): string {
  if (shape === 'alias') return fields.trackerProject.trim()
  return shape === 'within' ? fields.team.trim() : ''
}

/** The tracker's value of a `within` project: the team goes before a slash once the key is not the team's (`linearPlace`). */
function withinValue(fields: WizardFields): string {
  const team = fields.team.trim()
  const project = fields.trackerProject.trim()
  return team === '' || team === fields.key.trim() ? project : `${team}/${project}`
}

const KEY_LENGTH = 5

/** The draft the service checks and adds; `undefined` — the pool size is not a whole number above zero. */
export function draftOfFields(fields: WizardFields, defaultProfile = false): ProjectDraft | undefined {
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
    trackerProject: withinValue(fields),
    profile: fields.profile === '' || defaultProfile ? null : fields.profile,
    slot,
  }
}

/** A field typed by hand; cleared, it takes suggestions again. */
export function typedIn(fields: WizardFields, field: Suggested, value: string): WizardFields {
  return { ...fields, [field]: value, typed: { ...fields.typed, [field]: value.trim() !== '' } }
}

/** The fields with the suggestions put into those not typed by hand. */
function suggest(fields: WizardFields, values: Partial<Record<Suggested, string>>): WizardFields {
  const next = { ...fields }
  for (const [field, value] of Object.entries(values) as [Suggested, string][]) if (!fields.typed[field]) next[field] = value
  return next
}

/** Another profile: its kind's tracker, and the suggestions of the last kind cleared. */
export function switchProfile(fields: WizardFields, profile: { id: string; kind: string }): WizardFields {
  if (profile.kind === fields.tracker) return { ...fields, profile: profile.id }
  return suggest({ ...fields, profile: profile.id, tracker: profile.kind, team: '' }, { key: '', name: '', trackerProject: '' })
}

/** A team typed or picked: the key follows it while it is not typed by hand. */
export function teamIn(fields: WizardFields, team: string): WizardFields {
  return suggest({ ...fields, team }, { key: team })
}

/** A project picked from the tracker's list fills what it names: the key, the tracker's value and the name. */
export function pickProject(fields: WizardFields, shape: TrackerShape, project: TrackerProject): WizardFields {
  if (shape === 'key') return suggest({ ...fields, key: project.key, typed: { ...fields.typed, key: true } }, { name: project.name })
  if (shape === 'within') {
    return suggest({ ...fields, team: project.key, trackerProject: project.within ?? '' }, { key: project.key, name: project.name })
  }
  if (shape === 'alias') {
    return suggest({ ...fields, trackerProject: project.key, typed: { ...fields.typed, trackerProject: true } }, { key: project.key, name: project.name })
  }
  return suggest({ ...fields, trackerProject: project.key, typed: { ...fields.typed, trackerProject: true } }, { key: keyOfFolder(project.name), name: project.name })
}

/**
 * What a found repository suggests: its current branch, and on a tracker whose key is a free prefix the tracker's
 * value its remote names, the key and the name from the repository's name (or the folder's).
 */
export function suggestOfRepo(fields: WizardFields, shape: TrackerShape, repo: Pick<ProjectCheck['repo'], 'root' | 'current' | 'suggested'>): WizardFields {
  if (repo.root === null) return fields
  const branched = { ...fields, branch: fields.branch || (repo.current ?? '') }
  if (shape !== 'place') return branched
  const place = fields.typed.trackerProject ? fields.trackerProject : (repo.suggested ?? fields.trackerProject)
  const name = place.includes('/') ? place.slice(place.lastIndexOf('/') + 1) : lastPart(repo.root)
  return suggest(branched, { trackerProject: place, key: keyOfFolder(name), name })
}

/** The repository, the entry and the tracker passed; the trust is only a warning, it can be given after. */
export function readyToAdd(check: ProjectCheck | null): boolean {
  return check !== null && check.repo.root !== null && check.repo.notice === null && check.entry === null && check.tracker?.ok === true
}

/** What to run in a terminal on the service's machine to open `claude` in the folder and accept its trust dialog. */
export function trustCommand(folder: string, platform: string): string {
  if (platform === 'win32') return `pushd "${folder}" && claude`
  return `cd '${folder.replace(/'/g, `'\\''`)}' && claude`
}

/** Why "Add" is closed, the first reason in the order of the steps; `null` — it is open. */
export type Missing = 'repo' | 'profile' | 'place' | 'project' | 'key' | 'checking' | 'repoError' | 'entry' | 'tracker'

export function missingOf(fields: WizardFields, shape: TrackerShape, check: ProjectCheck | null): Missing | null {
  if (fields.repo.trim() === '') return 'repo'
  if (check?.repo.notice != null) return 'repoError'
  if (fields.profile === '') return 'profile'
  if (shape === 'place' && fields.trackerProject.trim() === '') return 'place'
  if (shape === 'alias' && fields.trackerProject.trim() === '') return 'project'
  if (shape === 'within' && fields.team.trim() === '') return 'project'
  if (fields.key.trim() === '') return keyTyped(shape) ? 'key' : 'project'
  if (check === null) return 'checking'
  if (check.entry !== null) return 'entry'
  if (check.tracker?.ok !== true) return check.tracker === null ? 'checking' : 'tracker'
  return null
}

/** A key suggested by a folder's or a repository's name: the initials of its words, or the first letters of a single word. */
export function keyOfFolder(path: string): string {
  const words = lastPart(path)
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((word) => /^[A-Z]/.test(word))
  if (words.length === 0) return ''
  const key = words.length === 1 ? words[0]!.slice(0, 3) : words.map((word) => word[0]).join('')
  return key.slice(0, KEY_LENGTH)
}

function lastPart(path: string): string {
  return path.split(/[\\/]/).filter((part) => part !== '').pop() ?? ''
}
