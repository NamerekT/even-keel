import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import type { EvenKeelState, ProfileView, ProjectCheck, TrackerChoice } from '../../../src/state.js'
import type { TrackerProject } from '../../../src/tracker/source.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { PlusIcon, TrackerIcon } from '../ui/icons.js'
import { Select } from '../ui/Select.js'
import { ProfileDialog } from './ProfileDialog.js'
import { daysLeft } from './profileForm.js'
import { pickProject, switchProfile, typedIn, type TrackerShape, type WizardFields } from './projectWizard.js'
import { FieldHead } from './settingsParts.js'

const LOOKUP_DELAY_MS = 300
/** The Select's value of "Add profile": no profile has it as its id. */
const ADD = '+add'

interface TrackerStepProps {
  state: EvenKeelState
  fields: WizardFields
  shape: TrackerShape
  choice: TrackerChoice | undefined
  /** The fresh check's answer; `null` while none. */
  check: ProjectCheck | null
  onChange: (change: (before: WizardFields) => WizardFields) => void
}

/**
 * The tracker step: the profile, then the field its kind names a project by, with the profile's projects as suggestions.
 * Its rows keep their height whatever the kind, so the steps below do not jump when the profile changes.
 */
export function TrackerStep({ state, fields, shape, choice, check, onChange }: TrackerStepProps) {
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState<string | null>(null)
  const trackerKinds = state.profiles.kinds.filter((kind) => kind.tracker)
  const profiles = state.profiles.profiles.filter((profile) => trackerKinds.some((kind) => kind.kind === profile.kind))
  const profile = profiles.find((each) => each.id === fields.profile)
  const title = choice?.title ?? trackerKinds.find((kind) => kind.kind === fields.tracker)?.title ?? ''
  const query = shape === 'place' ? fields.trackerProject : fields.key
  const lookup = useProjects(profile?.id ?? null, query, shape !== 'within')

  // A profile just saved from the dialog is chosen once the state has it.
  useEffect(() => {
    const saved = profiles.find((each) => each.id === added)
    if (saved === undefined) return
    setAdded(null)
    onChange((before) => switchProfile(before, saved))
  }, [added, profiles, onChange])

  // A value typed in full that the tracker has: its name and the rest come from it, as if picked.
  const exact = exactOf(shape, fields, lookup.list)
  useEffect(() => {
    if (exact !== undefined) onChange((before) => pickProject(before, shape, exact))
  }, [exact?.key, exact?.name, exact?.within, shape])

  const options = [
    ...profiles.map((each) => ({ value: each.id, label: each.name, icon: <TrackerIcon kind={each.kind} /> })),
    { value: ADD, label: t.wizard.addProfile, icon: <PlusIcon /> },
  ]
  const pick = (value: string) => {
    const next = profiles.find((each) => each.id === value)
    if (next === undefined) setAdding(true)
    else onChange((before) => switchProfile(before, next))
  }

  const absent = shape === 'key' && lookup.of === fields.key.trim() && fields.key.trim() !== '' && exact === undefined && lookup.failure === null
  const status = absent ? (
    <Status>{t.wizard.noSuchProject(title, fields.key.trim())}</Status>
  ) : lookup.failure !== null ? (
    <Status>{say(lookup.failure)}</Status>
  ) : shape !== 'place' && check?.entry != null && fields.key.trim() !== '' ? (
    <Status>{say(check.entry)}</Status>
  ) : check?.tracker?.notice != null ? (
    <Status>{say(check.tracker.notice)}</Status>
  ) : check?.tracker?.ok === true ? (
    <Status ok>{t.wizard.trackerOk(check.tracker.open ?? 0)}</Status>
  ) : null

  return (
    <>
      <div className="settings__row project-add__profile-row">
        <div className="settings__field">
          <FieldHead label={t.wizard.profile} hint={t.wizard.profileHint} htmlFor="wizard-profile" />
          <Select id="wizard-profile" className="settings__text project-add__profile" value={fields.profile} options={options} onChange={pick} />
        </div>
        <span className="project-add__profile-state">
          {profiles.length === 0 ? (
            <button type="button" className="button button--small" aria-haspopup="dialog" onClick={() => setAdding(true)}>
              <PlusIcon />
              {t.wizard.addProfile}
            </button>
          ) : profile === undefined ? (
            <span className="settings__hint">{t.wizard.pickProfile}</span>
          ) : (
            <ProfileState profile={profile} />
          )}
        </span>
      </div>
      {profiles.length === 0 && <p className="settings__hint">{t.wizard.noProfiles}</p>}
      <div className="settings__row">
        <ProjectFields shape={shape} kind={fields.tracker} title={title} choice={choice} fields={fields} disabled={profile === undefined} list={lookup.list} exact={exact} onChange={onChange} />
      </div>
      <div className="project-add__slot">{status}</div>
      {adding &&
        createPortal(
          <ProfileDialog kinds={trackerKinds} profile={undefined} onClose={() => setAdding(false)} onSaved={(id) => setAdded(id)} />,
          document.body,
        )}
    </>
  )
}

interface ProjectFieldsProps {
  shape: TrackerShape
  kind: string
  title: string
  choice: TrackerChoice | undefined
  fields: WizardFields
  disabled: boolean
  list: TrackerProject[]
  exact: TrackerProject | undefined
  onChange: TrackerStepProps['onChange']
}

function ProjectFields({ shape, kind, title, choice, fields, disabled, list, exact, onChange }: ProjectFieldsProps) {
  if (disabled) return <TextField id="wizard-tracker-project" label={t.wizard.trackerField} value="" disabled grow onChange={() => {}} />
  if (shape === 'key') {
    return (
      <TextField
        id="wizard-tracker-project"
        label={t.settings.trackerProject(kind, title)}
        hint={t.wizard.projectHint(title)}
        value={fields.key}
        placeholder="ABC"
        upper
        options={list.map((each) => ({ value: each.key, label: each.name }))}
        aside={exact === undefined ? undefined : t.wizard.match(exact.key, exact.name)}
        onChange={(value) => onChange((before) => typedIn(before, 'key', value.toUpperCase()))}
      />
    )
  }
  if (shape === 'place') {
    return (
      <TextField
        id="wizard-tracker-project"
        label={t.settings.trackerProject(kind, title)}
        hint={t.wizard.repoPlaceHint}
        value={fields.trackerProject}
        placeholder={choice?.projectKey?.example}
        grow
        options={list.map((each) => ({ value: each.key, label: each.name }))}
        onChange={(value) => onChange((before) => typedIn(before, 'trackerProject', value))}
      />
    )
  }
  const teams = list.filter((each) => each.within === undefined)
  const within = list.filter((each) => each.within !== undefined && each.key === fields.key.trim())
  return (
    <>
      <TextField
        id="wizard-tracker-project"
        label={t.wizard.team}
        hint={t.wizard.teamHint(title)}
        value={fields.key}
        placeholder="ENG"
        upper
        options={teams.map((each) => ({ value: each.key, label: each.name }))}
        onChange={(value) => onChange((before) => typedIn(before, 'key', value.toUpperCase()))}
      />
      <TextField
        id="wizard-tracker-within"
        label={t.settings.trackerProject(kind, title)}
        hint={t.settings.trackerProjectOptional}
        value={fields.trackerProject}
        placeholder={choice?.projectKey?.example}
        grow
        options={within.map((each) => ({ value: each.within!, label: each.name }))}
        onChange={(value) => onChange((before) => typedIn(before, 'trackerProject', value))}
      />
    </>
  )
}

interface TextFieldProps {
  id: string
  label: string
  hint?: string
  value: string
  placeholder?: string
  upper?: boolean
  grow?: boolean
  disabled?: boolean
  /** The suggestions of the browser's own list. */
  options?: { value: string; label: string }[]
  /** A line right of the field: what the value was found as. */
  aside?: string
  onChange: (value: string) => void
}

function TextField({ id, label, hint, value, placeholder, upper = false, grow = false, disabled = false, options = [], aside, onChange }: TextFieldProps) {
  return (
    <div className={grow ? 'settings__field settings__grow' : 'settings__field'}>
      <FieldHead label={label} hint={hint} htmlFor={id} />
      <span className="project-add__input-row">
        <input
          id={id}
          className={`settings__text settings__text--mono${upper ? ' project-add__key' : ''}`}
          spellCheck={false}
          autoComplete="off"
          list={options.length > 0 ? `${id}-list` : undefined}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        {aside !== undefined && <span className="project-add__aside">{aside}</span>}
      </span>
      {options.length > 0 && (
        <datalist id={`${id}-list`}>
          {options.map((option) => (
            <option key={`${option.value}\u0000${option.label}`} value={option.value} label={option.label} />
          ))}
        </datalist>
      )}
    </div>
  )
}

/** Whom the profile signs in as, or why it does not. */
function ProfileState({ profile }: { profile: ProfileView }) {
  const { state, error } = profile.check
  const expired = profile.expiresAt !== null && daysLeft(profile.expiresAt, Date.now()) <= 0
  if (expired) return <Status>{t.profiles.expires(0)}</Status>
  if (state === 'ok') return <Status ok>{profile.login === null ? t.profiles.states.ok : t.wizard.signedIn(profile.login)}</Status>
  if (error !== null && (state === 'refused' || state === 'unreachable')) return <Status>{say(error)}</Status>
  return <span className="settings__hint">{t.profiles.states[state]}</span>
}

/** The value typed in full that one of the tracker's projects has. */
function exactOf(shape: TrackerShape, fields: WizardFields, list: TrackerProject[]): TrackerProject | undefined {
  const key = fields.key.trim()
  if (shape === 'place') return list.find((each) => each.key === fields.trackerProject.trim())
  if (shape === 'key') return list.find((each) => each.key === key)
  const project = fields.trackerProject.trim()
  if (project !== '') return list.find((each) => each.key === key && each.within === project)
  return list.find((each) => each.key === key && each.within === undefined)
}

interface Lookup {
  list: TrackerProject[]
  /** The text the list answers; `null` — none asked yet. */
  of: string | null
  failure: Notice | null
}

/**
 * The profile's projects that have the text, asked a moment after the last keystroke.
 * With `keepPicked`, a text that is a key of the list already shown is not asked again: a new list in the datalist
 * makes the browser open it again under the focused field, a second or two after the user picked from it.
 */
function useProjects(profile: string | null, text: string, keepPicked: boolean): Lookup {
  const { query } = useLive()
  const [lookup, setLookup] = useState<Lookup>({ list: [], of: null, failure: null })
  // The profile whose answer the list is: the reset below lands after this render's effects read the list.
  const listed = useRef<string | null>(null)
  const wanted = text.trim()
  useEffect(() => {
    listed.current = null
    setLookup({ list: [], of: null, failure: null })
  }, [profile])
  useEffect(() => {
    if (profile === null) return
    if (keepPicked && wanted !== '' && listed.current === profile && lookup.list.some((each) => each.key === wanted)) return
    let live = true
    const timer = setTimeout(() => {
      query<TrackerProject[]>('profiles/projects', { id: profile, query: wanted }).then(
        (list) => {
          if (!live) return
          listed.current = profile
          setLookup({ list, of: wanted, failure: null })
        },
        (error: unknown) => live && setLookup({ list: [], of: wanted, failure: noticeOf(error) }),
      )
    }, LOOKUP_DELAY_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // `query` is a new function on each render, the list only says whether to ask; the profile and the text are what the list answers.
  }, [profile, wanted, keepPicked])
  return lookup
}

export function Status({ ok = false, children }: { ok?: boolean; children: ReactNode }) {
  return (
    <span className={ok ? 'project-add__status project-add__status--ok' : 'project-add__status'} role={ok ? undefined : 'alert'}>
      {children}
    </span>
  )
}
