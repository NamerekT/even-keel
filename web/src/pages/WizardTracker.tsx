import type { EvenKeelState, ProjectCheck } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { keyTyped, type TrackerShape, type WizardFields } from './projectWizard.js'
import { Status, TrackerFields } from './TrackerFields.js'

interface TrackerStepProps {
  state: EvenKeelState
  fields: WizardFields
  shape: TrackerShape
  /** The fresh check's answer; `null` while none. */
  check: ProjectCheck | null
  onChange: (change: (before: WizardFields) => WizardFields) => void
}

/** The wizard's tracker step: the tracker block with the check's answer under it. */
export function TrackerStep({ state, fields, shape, check, onChange }: TrackerStepProps) {
  const kinds = state.profiles.kinds.filter((kind) => kind.tracker)
  const profiles = state.profiles.profiles.filter((profile) => kinds.some((kind) => kind.kind === profile.kind))
  const status =
    // Milestones a shared tracker project needs are said under their field, on the project step.
    !keyTyped(shape) && check?.entry != null && check.entry.code !== 'wizard.trackerShared' && fields.key.trim() !== '' ? (
      <Status>{say(check.entry)}</Status>
    ) : check?.tracker?.notice != null ? (
      <Status>{say(check.tracker.notice)}</Status>
    ) : check?.tracker?.ok === true ? (
      <Status ok>{t.wizard.trackerOk(check.tracker.open ?? 0)}</Status>
    ) : null

  return (
    <>
      <TrackerFields
        ids={(field) => `wizard-${field}`}
        state={state}
        fields={fields}
        profiles={profiles}
        kinds={kinds}
        profileHint={t.wizard.profileHint}
        status={status}
        onChange={onChange}
      />
      {check?.tracker?.ok === true && check.tracker.openToAll && (
        <p className="project-add__open" role="note">
          {t.wizard.openToAll}
        </p>
      )}
    </>
  )
}
