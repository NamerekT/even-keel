import { BUILTIN } from '../../../src/builtin/model.js'
import type { ProjectCheck, ProjectDraft, RepoSource, TrackerChoice } from '../../../src/state.js'
import type { TrackerProject } from '../../../src/tracker/source.js'
import type { StepCheck } from './wizard.js'

/** The fields a suggestion fills while the user has not typed them. */
type Suggested = 'key' | 'name' | 'trackerProject'

/** The wizard's fields as typed; `slots` counts only while the place is a pool of slots. */
export interface WizardFields {
  /** `false` — a project without git: the folder may be blank, the branch and the tasks' folders are not asked. */
  git: boolean
  /** Where the repository comes from (BTN-1048); not read without git. */
  source: RepoSource
  /** The address a clone is made from. */
  remote: string
  /** The folder's name in Even Keel's projects folder; blank — the one the check suggests. */
  folder: string
  /** "Another folder…": `repo` is the folder's full path instead of a name in the projects folder. */
  other: boolean
  /** The full path of a checkout already there, or of "another folder". */
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
  /** The only milestones the project takes, one per line: how it splits a tracker project another project has (BTN-306). */
  milestones: string
  /** The agent the project runs on (BTN-310); blank — the shared provider. */
  provider: string
  /** The fields typed by hand: a suggestion no longer overwrites them. */
  typed: Record<Suggested, boolean>
}

export const EMPTY_FIELDS: WizardFields = {
  git: true,
  source: 'clone',
  remote: '',
  folder: '',
  other: false,
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
  milestones: '',
  provider: '',
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

/** The field named by an entry refusal; blank required values are explained by the footer instead. */
export function entryField(fields: WizardFields, shape: TrackerShape, entry: ProjectCheck['entry']): 'key' | 'tracker' | 'milestones' | null {
  if (entry === null) return null
  if (entry.code === 'wizard.trackerShared') return 'milestones'
  if (entry.code === 'wizard.keyShape' || entry.code === 'wizard.keyTaken') {
    if (fields.key.trim() === '') return null
    return keyTyped(shape) ? 'key' : 'tracker'
  }
  if (entry.code === 'wizard.trackerPlace') {
    const value = shape === 'key' ? fields.key : shape === 'within' ? fields.team : fields.trackerProject
    if (value.trim() === '') return null
  }
  return 'tracker'
}

/** The prefix the project's task ids will have where they are the tracker's own; blank — the key's. */
export function idPrefix(shape: TrackerShape, fields: WizardFields): string {
  if (shape === 'alias') return fields.trackerProject.trim()
  return shape === 'within' ? fields.team.trim() : ''
}

/**
 * The tracker's value the fields name: on a `within` tracker the team goes before a slash once the key is not the
 * team's (`linearPlace`); on the others the team is blank, so it is the tracker project as typed, spaces and all.
 */
export function placeOf(fields: Pick<WizardFields, 'key' | 'team' | 'trackerProject'>): string {
  const team = fields.team.trim()
  return team === '' || team === fields.key.trim() ? fields.trackerProject : `${team}/${fields.trackerProject}`
}

/** A team before the slash, as `linearPlace` reads it. */
const TEAM_VALUE = /^([A-Z][A-Z0-9_]{0,6})\/(.*)$/

/**
 * What the tracker's answer for a draft depends on (BTN-737): the tracker, the profile, the tracker's project as the
 * adapter reads it and the milestones the chain takes. The key counts only where it names the tracker's project; the
 * name, the folder, the branch, the folders of tasks and the agent never do. The same basis — the page holds the answer.
 */
export function trackerBasis(draft: ProjectDraft, shape: TrackerShape): string {
  let place = draft.trackerProject
  if (shape === 'key') place = draft.key
  if (shape === 'within') {
    const named = TEAM_VALUE.exec(draft.trackerProject)
    place = named === null ? `${draft.key}/${draft.trackerProject}` : `${named[1]}/${named[2]!.trim()}`
  }
  return JSON.stringify([draft.tracker, draft.profile, place, draft.milestones])
}

/** A saved tracker value back in the fields `placeOf` makes it of; the team blank while it is the key's. */
export function placeFields(shape: TrackerShape, key: string, value: string): Pick<WizardFields, 'team' | 'trackerProject'> {
  const named = shape === 'within' ? TEAM_VALUE.exec(value.trim()) : null
  if (named === null || named[1] === key) return { team: '', trackerProject: named?.[2] ?? value }
  return { team: named[1]!, trackerProject: named[2]! }
}

const KEY_LENGTH = 5

/** The folder is typed as a full path: a checkout already there, or "another folder"; else a name in the projects folder. */
export const pathTyped = (fields: Pick<WizardFields, 'git' | 'source' | 'other'>): boolean => (fields.git && fields.source === 'existing') || fields.other

/** The field the repository step cannot be checked without is blank: the remote of a clone, a typed path. */
export function repoBlank(fields: Pick<WizardFields, 'git' | 'source' | 'other' | 'remote' | 'repo'>): boolean {
  if (fields.git && fields.source === 'clone' && fields.remote.trim() === '') return true
  return pathTyped(fields) && fields.repo.trim() === ''
}

/** What the folder block knows: `answer` — a place or a refusal for these fields, `remoteHeard` — a clone's remote answered before. */
export interface FolderKnown {
  answer: boolean
  remoteHeard: boolean
  /** A check of these fields is due or running. */
  pending: boolean
}

/**
 * Whether the folder block of a clone, a new repository or a project without git shows, and the line under it while
 * nothing is answered (BTN-1086). Only a clone's own blank name waits for its remote: the name comes from it. The rest
 * show always, blank and waiting too.
 */
export function folderView(
  fields: Pick<WizardFields, 'git' | 'source' | 'other' | 'folder'>,
  known: FolderKnown,
): { shown: boolean; note: 'checking' | 'blank' | null } {
  const typed = pathTyped(fields)
  const blank = !typed && fields.folder.trim() === ''
  const clone = fields.git && fields.source === 'clone'
  const shown = !clone || !blank || known.answer || known.remoteHeard
  if (!shown || known.answer) return { shown, note: null }
  return { shown, note: known.pending ? 'checking' : blank ? 'blank' : null }
}

/** The draft the service checks and adds; `undefined` — the pool size is not a whole number above zero. */
export function draftOfFields(fields: WizardFields, defaultProfile = false): ProjectDraft | undefined {
  let slot = 0
  if (fields.git && fields.place === 'slots') {
    const text = fields.slots.trim()
    slot = /^\d+$/.test(text) ? Number(text) : 0
    if (slot < 1) return undefined
  }
  const typed = pathTyped(fields)
  return {
    repo: typed ? fields.repo.trim() : '',
    branch: fields.git ? fields.branch.trim() : '',
    key: fields.key.trim(),
    name: fields.name.trim(),
    tracker: fields.tracker,
    trackerProject: placeOf({ ...fields, trackerProject: fields.trackerProject.trim() }),
    profile: fields.profile === '' || defaultProfile ? null : fields.profile,
    slot,
    milestones: fields.milestones
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== ''),
    provider: fields.provider === '' ? null : fields.provider,
    ...(fields.git ? { source: fields.source } : { git: false }),
    ...(fields.git && fields.source === 'clone' ? { remote: fields.remote.trim() } : {}),
    ...(typed ? {} : { folder: fields.folder.trim() }),
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

/** The tracker is chosen: a profile, or Even Keel's own tracker, which needs none (BTN-769). */
export const trackerChosen = (fields: Pick<WizardFields, 'profile' | 'tracker'>): boolean => fields.profile !== '' || fields.tracker === BUILTIN

/** Even Keel's own tracker: no profile, and the suggestions of the last kind cleared. */
export function switchBuiltin(fields: WizardFields): WizardFields {
  if (fields.tracker === BUILTIN && fields.profile === '') return fields
  return suggest({ ...fields, profile: '', tracker: BUILTIN, team: '' }, { key: '', name: '', trackerProject: '' })
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
  if (repo.root === null || !fields.git) return fields
  const branched = { ...fields, branch: fields.branch || (repo.current ?? '') }
  if (shape !== 'place') return branched
  const place = fields.typed.trackerProject ? fields.trackerProject : (repo.suggested ?? fields.trackerProject)
  const name = place.includes('/') ? place.slice(place.lastIndexOf('/') + 1) : lastPart(repo.root)
  return suggest(branched, { trackerProject: place, key: keyOfFolder(name), name })
}

/** The repository, the entry and the tracker passed; Claude trust is saved before launch. */
export function readyToAdd(check: ProjectCheck | null): boolean {
  return check !== null && check.repo.root !== null && check.repo.notice === null && check.entry === null && check.tracker?.ok === true
}


/** Why "Add" is closed, the first reason in the order of the steps; `null` — it is open. */
export type Missing = 'remote' | 'repo' | 'profile' | 'place' | 'project' | 'key' | 'checking' | 'repoError' | 'entry' | 'tracker'

export function missingOf(fields: WizardFields, shape: TrackerShape, check: ProjectCheck | null): Missing | null {
  if (repoBlank(fields)) return fields.git && fields.source === 'clone' && fields.remote.trim() === '' ? 'remote' : 'repo'
  if (check?.repo.notice != null) return 'repoError'
  if (!trackerChosen(fields)) return 'profile'
  if (shape === 'place' && fields.trackerProject.trim() === '') return 'place'
  if (shape === 'alias' && fields.trackerProject.trim() === '') return 'project'
  if (shape === 'within' && fields.team.trim() === '') return 'project'
  if (fields.key.trim() === '') return keyTyped(shape) ? 'key' : 'project'
  if (check === null) return 'checking'
  if (check.entry !== null) return 'entry'
  if (check.tracker?.ok !== true) return check.tracker === null ? 'checking' : 'tracker'
  return null
}

/** What the project's twelfth task will be called and its branch (none without git); `null` — no key to name it by yet. */
export function taskExample(shape: TrackerShape, fields: WizardFields): string | null {
  const prefix = idPrefix(shape, fields) || fields.key.trim()
  if (prefix === '') return null
  if (!fields.git) return shape === 'place' ? `#12 → ${prefix}-12` : `${prefix}-12`
  const named =`${prefix}-12 → ${prefix.toLowerCase()}-12/task`
  return shape === 'place' ? `#12 → ${named}` : named
}

/** The tracker's project the fields name, as a person reads it: a team and its project apart; blank — none yet. */
export function trackerPlace(shape: TrackerShape, fields: WizardFields): string {
  if (shape === 'key') return fields.key.trim()
  if (shape !== 'within') return fields.trackerProject.trim()
  return [fields.team.trim() || fields.key.trim(), fields.trackerProject.trim()].filter((part) => part !== '').join(' / ')
}

/** The wizard's steps in order, each a card with its dot. */
export const WIZARD_STEPS = ['agent', 'repo', 'tracker', 'project', 'place'] as const
export type WizardStepId = (typeof WIZARD_STEPS)[number]

/**
 * What each step's dot says by the check: the folder by its own lines (`repoCheck` holds while another field is checked
 * again), the tracker by its answer (`tracker` holds while its `trackerBasis` does), the key by the entry — on the
 * tracker's step where the tracker's project is the key. Milestones a shared tracker project needs are the project
 * step's: their field is there.
 */
export function stepChecks(
  fields: WizardFields,
  shape: TrackerShape,
  check: ProjectCheck | null,
  repoCheck: ProjectCheck | null,
  agent: StepCheck,
  tracker: ProjectCheck['tracker'] = check?.tracker ?? null,
): Record<WizardStepId, StepCheck> {
  const key = fields.key.trim()
  const entry = check?.entry ?? null
  const refused = entryField(fields, shape, entry)
  const repo = repoBlank(fields) ? 'empty' : repoCheck?.repo.notice != null ? 'failed' : repoCheck?.repo.root != null ? 'passed' : 'empty'
  const trackerAnswer = tracker === null ? 'empty' : tracker.ok ? 'passed' : 'failed'
  const trackerStep = !trackerChosen(fields) ? 'empty' : refused === 'tracker' ? 'failed' : trackerAnswer
  const project =
    refused === 'milestones' || refused === 'key' ? 'failed' : key !== '' && check !== null && entry === null ? 'passed' : 'empty'
  return { agent, repo, tracker: trackerStep, project, place: draftOfFields(fields) === undefined ? 'failed' : 'passed' }
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

/** The key as typed, kept to what a key may hold (`PROJECT_KEY`): capital Latin letters, digits and _, a letter first. */
export function keyOfTyped(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '')
    .replace(/^[^A-Z]+/, '')
    .slice(0, KEY_LENGTH)
}

function lastPart(path: string): string {
  return path.split(/[\\/]/).filter((part) => part !== '').pop() ?? ''
}
