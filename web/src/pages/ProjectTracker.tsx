import type { ReactNode } from 'react'
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
  /** The chain has run a task of the project: neither the profile nor the tracker project change (BTN-66). */
  locked: boolean
  onEdit: (trackerProject: string) => void
  box: string
  note: ReactNode
  invalid: boolean
}

/**
 * The tracker block of a project's settings, the wizard's own: the profile applies at once, the tracker project goes
 * into the draft. A tracker changed in the draft keeps the profile until it is saved: a profile is linked only to its
 * project's saved tracker, so until then the field shows the default one the new tracker would run on.
 */
export function ProjectTracker({ state, project, tracker, trackerProject, locked, onEdit, box, note, invalid }: ProjectTrackerProps) {
  const { send, sending, failure } = useCommand()
  const own = state.profiles.profiles.filter((profile) => profile.kind === tracker)
  const fields = trackedFields(state, state.projectKeys[project] ?? '', tracker, linkedProfile(own, project), trackerProject)
  const change = (edit: (before: WizardFields) => WizardFields) => {
    const next = edit(fields)
    if (next.profile !== fields.profile) {
      const profile = own.find((each) => each.id === next.profile)
      void send('profiles/link', { project, profile: profile === undefined || profile.isDefault ? null : profile.id })
    }
    const value = placeOf(next)
    if (value !== placeOf(fields)) onEdit(value)
  }
  return (
    <TrackerFields
      ids={(field) => fieldId(field === 'project' ? 'trackerProject' : field === 'team' ? 'trackerTeam' : 'profile')}
      state={state}
      fields={fields}
      profiles={own}
      kinds={state.profiles.kinds.filter((kind) => kind.kind === tracker)}
      profileHint={t.profiles.fieldHint}
      keyFixed
      profileLocked={locked || sending || tracker !== state.config.projects[project]?.tracker}
      projectLocked={locked}
      soon={locked ? t.settings.trackerSoon : undefined}
      profileNote={<FieldNote error={failure} />}
      projectBox={box}
      projectNote={note}
      projectInvalid={invalid}
      onChange={change}
    />
  )
}
