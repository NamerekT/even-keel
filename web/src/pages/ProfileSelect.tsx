import type { EvenKeelState, ProfileView } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { Select } from '../ui/Select.js'
import { FieldHead, FieldNote } from './settingsParts.js'

interface ProfileFieldProps {
  id: string
  profiles: ProfileView[]
  kind: string
  /** A profile's id; blank — the kind's default. */
  value: string
  onChange: (value: string) => void
}

/** The wizard's choice of the tracker's profile; nothing while the kind has none (the tracker's check says so). */
export function ProfileField({ id, profiles, kind, value, onChange }: ProfileFieldProps) {
  const own = profiles.filter((profile) => profile.kind === kind)
  if (own.length === 0) return null
  const fallback = own.find((profile) => profile.isDefault)
  const options = [
    ...(fallback === undefined ? [] : [{ value: '', label: t.profiles.byDefault(fallback.name) }]),
    ...own.filter((profile) => !profile.isDefault).map((profile) => ({ value: profile.id, label: profile.name })),
  ]
  return (
    <div className="settings__field">
      <FieldHead label={t.profiles.field} hint={t.profiles.fieldHint} htmlFor={id} />
      <Select id={id} className="settings__text settings__short" value={value} options={options} onChange={onChange} />
    </div>
  )
}

/** The project settings' profile: applied at once, closed once the chain has run a task of the project (BTN-66). */
export function ProfileLink({ id, state, project }: { id: string; state: EvenKeelState; project: string }) {
  const { send, sending, failure } = useCommand()
  const kind = state.config.projects[project]?.tracker
  const own = state.profiles.profiles.filter((profile) => profile.kind === kind)
  if (own.length === 0) return null
  const current = own.find((profile) => profile.projectIds.includes(project))
  const locked = state.config.trackerLocked.includes(project)
  const pick = (value: string) => {
    const profile = own.find((each) => each.id === value)
    void send('profiles/link', { project, profile: profile === undefined || profile.isDefault ? null : profile.id })
  }
  return (
    <div className="settings__field">
      <FieldHead label={t.profiles.field} hint={t.profiles.fieldHint} htmlFor={id} soon={locked ? t.settings.trackerSoon : undefined} />
      <Select
        id={id}
        className="settings__text settings__short"
        value={current?.id ?? ''}
        options={own.map((profile) => ({ value: profile.id, label: profile.isDefault ? t.profiles.byDefault(profile.name) : profile.name }))}
        disabled={locked || sending}
        onChange={pick}
      />
      <FieldNote error={failure} />
    </div>
  )
}
