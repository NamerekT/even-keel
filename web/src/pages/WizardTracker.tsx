import type { EvenKeelState, ProjectCheck } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import type { StripLine } from '../ui/fieldStripFit.js'
import { entryField, type TrackerShape, type WizardFields } from './projectWizard.js'
import { Status, TrackerFields } from './TrackerFields.js'

interface TrackerStepProps {
  state: EvenKeelState
  fields: WizardFields
  shape: TrackerShape
  /** The fresh check's answer; `null` while none. */
  check: ProjectCheck | null
  /** The tracker's answer, held while its `trackerBasis` holds (BTN-737); `null` — none for these fields yet. */
  tracker: ProjectCheck['tracker']
  onChange: (change: (before: WizardFields) => WizardFields) => void
}

/** The wizard's tracker step: the tracker block with the check's answer under it. */
export function TrackerStep({ state, fields, shape, check, tracker, onChange }: TrackerStepProps) {
  const kinds = state.profiles.kinds.filter((kind) => kind.tracker)
  const profiles = state.profiles.profiles.filter((profile) => kinds.some((kind) => kind.kind === profile.kind))
  const refused = entryField(fields, shape, check?.entry ?? null) === 'tracker'
  const status: StripLine | null =
    tracker?.notice != null
      ? { tone: 'error', text: say(tracker.notice) }
      : tracker?.ok === true
        ? { tone: 'ok', text: t.wizard.trackerOk(tracker.open ?? 0), short: t.wizard.openTasks(tracker.open ?? 0) }
        : null

  return (
    <>
      <TrackerFields
        ids={(field) => `wizard-${field}`}
        state={state}
        fields={fields}
        profiles={profiles}
        kinds={kinds}
        profileHint={t.wizard.profileHint}
        projectNote={refused && <Status>{say(check!.entry!)}</Status>}
        projectInvalid={refused}
        status={status}
        onChange={onChange}
      />
      {tracker?.ok === true && tracker.openToAll && (
        <p className="project-add__open" role="note">
          {t.wizard.openToAll}
        </p>
      )}
    </>
  )
}
