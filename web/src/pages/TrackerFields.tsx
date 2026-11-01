import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { noticeOf } from '../../../src/notice/notice.js'
import type { EvenKeelState, ProfileKindView, ProfileView, TrackerChoice } from '../../../src/state.js'
import type { TrackerProject } from '../../../src/tracker/source.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import type { StripLine } from '../ui/fieldStripFit.js'
import { FieldStrip } from '../ui/FieldStrip.js'
import { PlusIcon, TrackerIcon } from '../ui/icons.js'
import { Select } from '../ui/Select.js'
import { SuggestField } from '../ui/SuggestField.js'
import { ProfileDialog } from './ProfileDialog.js'
import { EMPTY_LOOKUP, answered, failed, failureShown, retryDelay, type Lookup } from './projectLookup.js'
import { pickProject, placeOf, shapeOf, switchProfile, teamIn, typedIn, type TrackerShape, type WizardFields } from './projectWizard.js'
import { FieldHead } from './settingsParts.js'
import { profileLine, projectLine } from './trackerLines.js'
import './trackerFields.css'

const LOOKUP_DELAY_MS = 300
/** The Select's value of "Add profile": no profile has it as its id. */
const ADD = '+add'

type FieldName = 'profile' | 'project' | 'team'

interface TrackerFieldsProps {
  /** The id of each field's input. */
  ids: (field: FieldName) => string
  state: EvenKeelState
  fields: WizardFields
  /** The profiles on offer; "Add profile" offers their kinds' tiles. */
  profiles: readonly ProfileView[]
  kinds: readonly ProfileKindView[]
  onChange: (change: (before: WizardFields) => WizardFields) => void
  profileHint: string
  /**
   * The project's own key is fixed (its settings): the `key` shape shows no field, and a blank tracker project or team
   * is the key's.
   */
  keyFixed?: boolean
  /** The tracker project is the one saved: it was checked then, and a list that fails to load does not flag it. */
  known?: boolean
  /** The profile stays as it is. */
  profileLocked?: boolean
  /** The tracker project stays as it is. */
  projectLocked?: boolean
  /** The badge by the profile's head while it stays: why it does. */
  soon?: string
  /** The strip under the tracker project while the tracker's own answer has nothing wrong to say: a check's. */
  status?: StripLine | null
  /** Under the profile: what its change answered. */
  profileNote?: ReactNode
  /** In the profile's head: the mark of its unsaved change (`Marks.note`). */
  profileMark?: ReactNode
  /** The tracker project's field: its box's class, the mark in its head, what goes under it, whether it is refused. */
  projectBox?: string
  projectMark?: ReactNode
  projectNote?: ReactNode
  projectInvalid?: boolean
}

/**
 * A project's tracker: the profile, then on the same row the field its kind names a project by, with the profile's
 * projects as suggestions; a strip glued under the profile says whom it signs in as, one under the project what the
 * tracker answered. One block for the wizard, a project's settings and its task feeds. Its rows keep their height
 * whatever the kind, so the fields below do not jump when the profile changes.
 */
export function TrackerFields(props: TrackerFieldsProps) {
  const { ids, state, fields, profiles, kinds, onChange, keyFixed = false, status } = props
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState<string | null>(null)
  const choice = state.config.trackers.find((each) => each.name === fields.tracker)
  const shape = shapeOf(choice)
  const profile = profiles.find((each) => each.id === fields.profile)
  const title = choice?.title ?? kinds.find((kind) => kind.kind === fields.tracker)?.title ?? ''
  const looked = keyFixed ? withKey(shape, fields) : fields
  const query = shape === 'place' || shape === 'alias' ? looked.trackerProject : shape === 'within' ? looked.team : looked.key
  const lookup = useProjects(profile, query, shape !== 'within')

  // A profile just saved from the dialog is chosen once the state has it.
  useEffect(() => {
    const saved = profiles.find((each) => each.id === added)
    if (saved === undefined) return
    setAdded(null)
    onChange((before) => switchProfile(before, saved))
  }, [added, profiles, onChange])

  // A value typed in full that the tracker has: its name and the rest come from it, as if picked. With the key fixed
  // there is nothing else to fill, and a blank value the key stands for must stay blank.
  const exact = exactOf(shape, looked, lookup.list)
  useEffect(() => {
    if (exact !== undefined && !keyFixed) onChange((before) => pickProject(before, shape, exact))
  }, [exact?.key, exact?.name, exact?.within, shape])

  const named = shape === 'alias' ? looked.trackerProject.trim() : looked.key.trim()
  const absent = (shape === 'key' || shape === 'alias') && lookup.of === named && named !== '' && exact === undefined && lookup.failure === null
  // The list is only suggestions: its failure is an alert only for a typed value nothing else confirms.
  const failure = failureShown(lookup.failure, query, exact !== undefined || props.known === true)
  const projectSays = projectLine({
    absent: absent ? t.wizard.noSuchProject(title, named) : null,
    alert: failure === 'alert' ? say(lookup.failure!) : null,
    status: status ?? null,
    name: (shape === 'key' || shape === 'alias') && exact !== undefined ? exact.name : null,
    quiet: failure === 'quiet',
  })
  const profileSays = profileLineOf(profiles, profile)
  // With the key fixed the `key` shape has no field of its own: what is wrong with the project goes under the profile.
  const noProjectField = keyFixed && shape === 'key'

  return (
    <>
      <div className="settings__row tracker-fields__row">
        <ProfilePick {...props} line={noProjectField && projectSays?.tone === 'error' ? projectSays : profileSays} onAdd={() => setAdding(true)} />
        <ProjectFields {...props} shape={shape} title={title} choice={choice} disabled={profile === undefined} list={lookup.list} line={projectSays} />
      </div>
      {adding &&
        createPortal(<ProfileDialog kinds={[...kinds]} profile={undefined} onClose={() => setAdding(false)} onSaved={(id) => setAdded(id)} />, document.body)}
    </>
  )
}

function ProfilePick({ ids, profiles, fields, profileHint, profileLocked = false, soon, profileNote, profileMark, keyFixed = false, line, onChange, onAdd }: TrackerFieldsProps & { line: StripLine | null; onAdd: () => void }) {
  const options = [
    ...profiles.map((each) => ({ value: each.id, label: each.isDefault ? t.profiles.byDefault(each.name) : each.name, icon: <TrackerIcon kind={each.kind} /> })),
    { value: ADD, label: t.wizard.addProfile, icon: <PlusIcon /> },
  ]
  const pick = (value: string) => {
    const next = profiles.find((each) => each.id === value)
    if (next === undefined) onAdd()
    else onChange((before) => switchProfile(before, next))
  }
  // Nothing to pick from: the field is the button that adds one, not a list holding only "Add profile".
  if (profiles.length === 0)
    return (
      <div className="settings__field">
        <FieldHead label={t.profiles.field} hint={profileHint} soon={profileLocked ? soon : undefined} mark={profileMark} />
        <FieldStrip line={null}>
          <button type="button" id={ids('profile')} className="button tracker-fields__add" aria-haspopup="dialog" disabled={profileLocked} onClick={onAdd}>
            <PlusIcon />
            {t.wizard.addProfile}
          </button>
        </FieldStrip>
        {!keyFixed && <span className="settings__hint">{t.wizard.noProfiles}</span>}
        {profileNote}
      </div>
    )
  return (
    <div className="settings__field">
      <FieldHead label={t.profiles.field} hint={profileHint} htmlFor={ids('profile')} soon={profileLocked ? soon : undefined} mark={profileMark} />
      <FieldStrip line={line}>
        <Select id={ids('profile')} className="settings__text tracker-fields__wide" value={fields.profile} options={options} disabled={profileLocked} onChange={pick} />
      </FieldStrip>
      {profileNote}
    </div>
  )
}

/** The strip under the profile: whom it signs in as, or to choose one. */
function profileLineOf(profiles: readonly ProfileView[], profile: ProfileView | undefined): StripLine | null {
  if (profiles.length === 0) return null
  return profile === undefined ? { tone: 'plain', text: t.wizard.pickProfile } : profileLine(profile, Date.now())
}

interface ProjectFieldsProps extends TrackerFieldsProps {
  shape: TrackerShape
  title: string
  choice: TrackerChoice | undefined
  disabled: boolean
  list: TrackerProject[]
  /** The strip under the tracker project's field. */
  line: StripLine | null
}

function ProjectFields(props: ProjectFieldsProps) {
  const { ids, shape, title, choice, fields, disabled, list, line, onChange, keyFixed = false, projectLocked = false } = props
  const kind = fields.tracker
  const label = t.settings.trackerProject(kind, title)
  const owned = { disabled: projectLocked, box: props.projectBox, invalid: props.projectInvalid, mark: props.projectMark, children: props.projectNote }
  const options = list.map((each) => ({ value: each.key, label: each.name }))
  if (disabled) return <TextField id={ids('project')} label={t.wizard.trackerField} value={placeOf(fields)} disabled onChange={() => {}} />
  if (shape === 'key') {
    if (keyFixed) return null
    return (
      <TextField
        id={ids('project')}
        label={label}
        hint={t.wizard.projectHint(title)}
        value={fields.key}
        placeholder="ABC"
        upper
        options={options}
        line={line}
        onChange={(value) => onChange((before) => typedIn(before, 'key', value.toUpperCase()))}
        {...owned}
      />
    )
  }
  if (shape === 'alias' || shape === 'place') {
    const alias = shape === 'alias'
    return (
      <TextField
        id={ids('project')}
        label={label}
        hint={!alias ? t.wizard.repoPlaceHint : keyFixed ? t.settings.trackerProjectAlias : t.wizard.projectHint(title)}
        value={fields.trackerProject}
        placeholder={alias && keyFixed ? fields.key : choice?.projectKey?.example}
        upper={alias}
        options={options}
        line={line}
        onChange={(value) => onChange((before) => typedIn(before, 'trackerProject', alias ? value.toUpperCase() : value))}
        {...owned}
      />
    )
  }
  const team = withKey(shape, fields).team.trim()
  const teams = list.filter((each) => each.within === undefined)
  const within = list.filter((each) => each.within !== undefined && each.key === team)
  return (
    <>
      <TextField
        id={ids('team')}
        label={t.wizard.team}
        hint={keyFixed ? t.settings.trackerTeam : t.wizard.teamHint(title)}
        value={fields.team}
        placeholder={keyFixed ? fields.key : 'ENG'}
        upper
        options={teams.map((each) => ({ value: each.key, label: each.name }))}
        disabled={projectLocked}
        onChange={(value) => onChange((before) => teamIn(before, value.toUpperCase()))}
      />
      <TextField
        id={ids('project')}
        label={label}
        hint={t.settings.trackerProjectOptional}
        value={fields.trackerProject}
        placeholder={choice?.projectKey?.example}
        options={within.map((each) => ({ value: each.within!, label: each.name }))}
        line={line}
        onChange={(value) => onChange((before) => typedIn(before, 'trackerProject', value))}
        {...owned}
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
  disabled?: boolean
  invalid?: boolean
  /** The suggestions of the field's list: a tracker project's key and its name. */
  options?: { value: string; label: string }[]
  /** The strip under the field: what the value was found as, or what is wrong with it. */
  line?: StripLine | null
  /** The class of the field's box. */
  box?: string
  /** In the head: the mark of an unsaved change. */
  mark?: ReactNode
  onChange: (value: string) => void
  children?: ReactNode
}

function TextField({ id, label, hint, value, placeholder, upper = false, disabled = false, invalid = false, options = [], line = null, box = 'settings__field', mark, onChange, children }: TextFieldProps) {
  return (
    <div className={box}>
      <FieldHead label={label} hint={hint} htmlFor={id} mark={mark} />
      <FieldStrip line={line}>
        <SuggestField
          id={id}
          className={`settings__text settings__text--mono tracker-fields__wide${upper ? ' tracker-fields__upper' : ''}`}
          mono
          value={value}
          options={options}
          placeholder={placeholder}
          disabled={disabled}
          invalid={invalid}
          onChange={onChange}
        />
      </FieldStrip>
      {children}
    </div>
  )
}

/** Whom the profile signs in as, or why it does not. */
export function ProfileState({ profile }: { profile: ProfileView }) {
  const line = profileLine(profile, Date.now())
  return line.tone === 'plain' ? <span className="settings__hint">{line.text}</span> : <Status ok={line.tone === 'ok'}>{line.text}</Status>
}

/** The fields as the tracker reads them once the key is fixed: a blank tracker project or team is the key's. */
function withKey(shape: TrackerShape, fields: WizardFields): WizardFields {
  if (shape === 'alias' && fields.trackerProject.trim() === '') return { ...fields, trackerProject: fields.key }
  if (shape === 'within' && fields.team.trim() === '') return { ...fields, team: fields.key }
  return fields
}

/** The value typed in full that one of the tracker's projects has. */
function exactOf(shape: TrackerShape, fields: WizardFields, list: TrackerProject[]): TrackerProject | undefined {
  const key = fields.key.trim()
  if (shape === 'place' || shape === 'alias') return list.find((each) => each.key === fields.trackerProject.trim())
  if (shape === 'key') return list.find((each) => each.key === key)
  const team = fields.team.trim()
  const project = fields.trackerProject.trim()
  if (project !== '') return list.find((each) => each.key === team && each.within === project)
  return list.find((each) => each.key === team && each.within === undefined)
}

/**
 * The profile's projects that have the text, asked a moment after the last keystroke.
 * With `keepPicked`, a text that is a key of the list already shown is not asked again: a pick needs no new list.
 * A failed ask is asked again after a growing pause, and at once when the service restarts, the page reconnects or
 * the profile's check changes (BTN-621).
 */
function useProjects(profile: ProfileView | undefined, text: string, keepPicked: boolean): Lookup {
  const { query, state, link } = useLive()
  const id = profile?.id ?? null
  const [lookup, setLookup] = useState<Lookup>(EMPTY_LOOKUP)
  const [round, setRound] = useState(0)
  // The profile whose answer the list is: the reset below lands after this render's effects read the list.
  const listed = useRef<string | null>(null)
  const wanted = text.trim()
  useEffect(() => {
    listed.current = null
    setLookup(EMPTY_LOOKUP)
  }, [id])
  useEffect(() => {
    if (id === null) return
    if (keepPicked && lookup.failure === null && wanted !== '' && listed.current === id && lookup.list.some((each) => each.key === wanted)) return
    let live = true
    const timer = setTimeout(() => {
      query<TrackerProject[]>('profiles/projects', { id, query: wanted }).then(
        (list) => {
          if (!live) return
          listed.current = id
          setLookup(answered(list, wanted))
        },
        (error: unknown) => live && setLookup((before) => failed(before, wanted, noticeOf(error))),
      )
    }, LOOKUP_DELAY_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // `query` is a new function on each render, the list only says whether to ask; the profile, the text and a retry's round are what asks.
  }, [id, wanted, keepPicked, round])
  useEffect(() => {
    const delay = lookup.failure === null ? null : retryDelay(lookup.failures)
    if (delay === null) return
    const timer = setTimeout(() => setRound((before) => before + 1), delay)
    return () => clearTimeout(timer)
  }, [lookup])
  const wake = `${state?.startedAt ?? ''}|${link}|${profile?.check.state ?? ''}`
  const woke = useRef(wake)
  useEffect(() => {
    if (woke.current === wake) return
    woke.current = wake
    if (lookup.failure !== null && link === 'live') setRound((before) => before + 1)
  }, [wake])
  return lookup
}

export function Status({ ok = false, children }: { ok?: boolean; children: ReactNode }) {
  return (
    <span className={ok ? 'tracker-fields__status tracker-fields__status--ok' : 'tracker-fields__status'} role={ok ? undefined : 'alert'}>
      {children}
    </span>
  )
}
