import { useEffect, useState, type ReactNode } from 'react'
import { BUILTIN } from '../../../src/builtin/model.js'
import type { EvenKeelState, ProfileView } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { EMPTY_FIELDS, placeFields, placeOf, shapeOf, type WizardFields } from './projectWizard.js'
import { FieldNote, fieldId } from './settingsParts.js'
import { TrackerFields } from './TrackerFields.js'

/** Every field is the user's own here: a picked project fills nothing but its own value. */
const TYPED: WizardFields['typed'] = { key: true, name: true, trackerProject: true }

/** A project's or a feed's tracker as the wizard's fields: its key, its profile and its tracker value split as typed. */
export function trackedFields(state: EvenKeelState, key: string, tracker: string, profile: ProfileView | undefined, value: string): WizardFields {
  const shape = shapeOf(state.config.trackers.find((each) => each.name === tracker))
  return { ...EMPTY_FIELDS, key, tracker, profile: profile?.id ?? '', ...placeFields(shape, key, value), typed: TYPED }
}

/** The profile a project or a feed runs on: the one linked to it, else its kind's default. */
export function linkedProfile(own: readonly ProfileView[], id: string): ProfileView | undefined {
  return own.find((profile) => profile.projectIds.includes(id)) ?? own.find((profile) => profile.isDefault)
}

interface ProjectTrackerProps {
  state: EvenKeelState
  project: string
  /** The tracker and its project as the draft has them. */
  tracker: string
  trackerProject: string
  /** The tracker and its project are the saved ones. */
  known: boolean
  /** The chain has run a task of the project: neither the profile nor the tracker project change (BTN-66). */
  locked: boolean
  /** The project has tasks in its tracker: the built-in tracker is not swapped for another, nor another for it. */
  hasTasks: boolean
  /** The draft's tracker and tracker project: a profile of another tracker changes both. */
  onEdit: (tracker: string, trackerProject: string) => void
  /** In the profile's head: the draft's mark of the tracker; under it, its error. */
  trackerMark: ReactNode
  trackerNote: ReactNode
  box: string
  mark: ReactNode
  note: ReactNode
  invalid: boolean
}

/**
 * The tracker block of a project's settings, the wizard's own: there is no tracker field, the profile's kind is the
 * tracker, and the built-in tracker is the first pick, with no profile and no tracker project. A profile of the saved tracker applies at once, the tracker project goes into the draft. A profile of
 * another tracker puts that tracker into the draft and waits for the save: a profile is linked only to its project's
 * saved tracker.
 */
export function ProjectTracker({ state, project, tracker, trackerProject, known, locked, hasTasks, onEdit, trackerMark, trackerNote, box, mark, note, invalid }: ProjectTrackerProps) {
  const { send, sending, failure } = useCommand()
  const [waiting, setWaiting] = useState<string | null>(null)
  const kinds = state.profiles.kinds.filter((kind) => kind.tracker)
  const offered = state.profiles.profiles.filter((profile) => kinds.some((kind) => kind.kind === profile.kind))
  const own = offered.filter((profile) => profile.kind === tracker)
  const saved = state.config.projects[project]?.tracker
  const shown = own.find((each) => each.id === waiting) ?? (tracker === saved ? linkedProfile(own, project) : own.find((each) => each.isDefault))
  const fields = trackedFields(state, state.projectKeys[project] ?? '', tracker, shown, trackerProject)

  // The tracker saved: the profile chosen for it is linked now.
  useEffect(() => {
    if (waiting === null || tracker !== saved) return
    setWaiting(null)
    const profile = own.find((each) => each.id === waiting)
    if (profile !== undefined) void send('profiles/link', { project, profile: profile.isDefault ? null : profile.id })
  }, [waiting, tracker, saved])

  const change = (edit: (before: WizardFields) => WizardFields) => {
    const next = edit(fields)
    // The built-in tracker has no profile to link.
    if (next.tracker === BUILTIN) setWaiting(null)
    else if (next.profile !== fields.profile) {
      const profile = offered.find((each) => each.id === next.profile)
      if (profile !== undefined && profile.kind !== saved) setWaiting(profile.id)
      else {
        setWaiting(null)
        void send('profiles/link', { project, profile: profile === undefined || profile.isDefault ? null : profile.id })
      }
    }
    const value = placeOf(next)
    if (next.tracker !== fields.tracker || value !== placeOf(fields)) onEdit(next.tracker, value)
  }
  // Tasks of the built-in tracker do not move to another one, nor another's to it, yet: that is an export (BTN-769).
  const ownLocked = saved === BUILTIN && hasTasks
  const builtin = { unavailable: saved !== BUILTIN && hasTasks ? t.settings.builtinUnavailable : undefined }
  const hint = locked ? `${t.wizard.trackerPickHint} ${t.settings.trackerLocked}` : ownLocked ? `${t.wizard.trackerPickHint} ${t.settings.builtinLocked}` : t.wizard.trackerPickHint
  return (
    <TrackerFields
      ids={(field) => fieldId(field === 'project' ? 'trackerProject' : field === 'team' ? 'trackerTeam' : 'profile')}
      state={state}
      fields={fields}
      profiles={offered}
      kinds={kinds}
      profileHint={hint}
      builtin={builtin}
      keyFixed
      known={known}
      profileLocked={locked || ownLocked || sending}
      projectLocked={locked}
      soon={locked ? t.settings.trackerSoon : undefined}
      profileNote={
        <>
          {trackerNote}
          <FieldNote error={failure} />
        </>
      }
      profileMark={trackerMark}
      projectBox={box}
      projectMark={mark}
      projectNote={note}
      projectInvalid={invalid}
      onChange={change}
    />
  )
}
