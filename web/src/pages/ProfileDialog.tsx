import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import type { CheckResult, ProfileKindView, ProfileView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { Field } from '../tools/AddPackage.js'
import { TrackerIcon } from '../ui/icons.js'
import { alternativeOf, draftValues, shownFields } from './profileForm.js'

interface DialogProps {
  kinds: ProfileKindView[]
  /** The profile to edit; none — a new one. */
  profile: ProfileView | undefined
  onClose: () => void
}

/** "Add profile" and a profile's edit: the kind's tiles first for a new one, then its fields, Check, and Save once the check passed. */
export function ProfileDialog({ kinds, profile, onClose }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [kind, setKind] = useState<string | null>(profile?.kind ?? null)
  const title = useId()
  const view = kinds.find((each) => each.kind === kind)

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('.add-package__kinds button, .add-package__body input:not(:disabled)')?.focus()
  }, [kind])

  return (
    <dialog
      ref={dialog}
      className="add-package"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => event.target === dialog.current && onClose()}
    >
      <div className="add-package__frame">
        <header className="add-package__head">
          <h2 id={title} className="add-package__title">
            {profile !== undefined ? t.profiles.editTitle(profile.name) : view === undefined ? t.profiles.add : `${t.profiles.add} · ${view.title}`}
          </h2>
          <button type="button" className="panel__close" aria-label={t.packages.close} onClick={onClose}>
            ×
          </button>
        </header>
        {view === undefined ? (
          <KindStep kinds={kinds} onPick={setKind} />
        ) : (
          <FieldsStep kind={view} profile={profile} onBack={profile === undefined ? () => setKind(null) : undefined} onClose={onClose} />
        )}
      </div>
    </dialog>
  )
}

function KindStep({ kinds, onPick }: { kinds: ProfileKindView[]; onPick: (kind: string) => void }) {
  return (
    <div className="add-package__kinds">
      {kinds.map(({ kind, title }) => (
        <button key={kind} type="button" className="add-package__kind" onClick={() => onPick(kind)}>
          <span className="add-package__kind-icon">
            <TrackerIcon kind={kind} />
          </span>
          <span className="add-package__kind-title">{title}</span>
          <span className="add-package__kind-hint">{t.profiles.kindHint[kind] ?? ''}</span>
        </button>
      ))}
    </div>
  )
}

interface FieldsProps {
  kind: ProfileKindView
  profile: ProfileView | undefined
  /** None for an edit: the kind of a stored profile stays. */
  onBack: (() => void) | undefined
  onClose: () => void
}

interface Checked {
  /** The values the check was of: Save is open while the fields still hold them. */
  values: string
  result: CheckResult
}

function FieldsStep({ kind, profile, onBack, onClose }: FieldsProps) {
  const { query } = useLive()
  const [alternative, setAlternative] = useState(() => alternativeOf(kind, profile))
  const [typed, setTyped] = useState<Record<string, string>>(() =>
    Object.fromEntries((profile?.fields ?? []).filter((field) => field.value !== null).map((field) => [field.name, field.value!])),
  )
  const [name, setName] = useState(profile?.name ?? '')
  const [checked, setChecked] = useState<Checked | null>(null)
  const [failure, setFailure] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const values = draftValues(kind, alternative, typed)
  const key = JSON.stringify(values)
  const fresh = checked !== null && checked.values === key
  const hostLocked = (profile?.projects.length ?? 0) > 0
  const body = { kind: kind.kind, values, ...(profile === undefined ? {} : { id: profile.id }) }

  const run = async <T,>(route: string, extra: Record<string, unknown> = {}): Promise<T | null> => {
    setBusy(true)
    setFailure(null)
    try {
      return await query<T>(route, { ...body, ...extra })
    } catch (error) {
      setFailure(noticeOf(error))
      return null
    } finally {
      setBusy(false)
    }
  }

  const check = async () => {
    const result = await run<CheckResult>('profiles/check')
    if (result === null) return
    setChecked({ values: key, result })
    if (name.trim() === '' || name === checked?.result.name) setName(result.name)
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (fresh && (await run<{ id: string }>('profiles/save', { name: name.trim() })) !== null) onClose()
  }

  return (
    <form className="add-package__form" onSubmit={(event) => void save(event)}>
      <div className="add-package__body">
        <p className="settings__hint">
          {t.profiles.rights[kind.kind] ?? ''}{' '}
          <a href={kind.help} target="_blank" rel="noreferrer">
            {t.profiles.howTo}
          </a>
        </p>
        {kind.alternatives.length > 1 && (
          <fieldset className="add-package__field">
            <legend className="add-package__label add-package__legend">{t.profiles.signIn}</legend>
            <div className="add-package__switch">
              {kind.alternatives.map((names, index) => (
                <label key={names.join()} className="add-package__option">
                  <input type="radio" name="profile-sign-in" checked={alternative === index} onChange={() => setAlternative(index)} />
                  {t.profiles.alternative[names[0]!] ?? names.join(' + ')}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {shownFields(kind, alternative).map((field) => {
          const stored = profile?.fields.find((each) => each.name === field.name)
          const locked = hostLocked && kind.hostVariables.includes(field.name)
          return (
            <Field key={field.name} label={t.secrets.purpose[field.name] ?? field.name} hint={locked ? t.profiles.hostLocked : field.name}>
              {(id) => (
                <input
                  id={id}
                  className="add-package__input add-package__input--mono"
                  type={field.secret ? 'password' : 'text'}
                  value={typed[field.name] ?? ''}
                  placeholder={field.secret && stored?.set === true ? t.profiles.kept : field.name}
                  disabled={locked}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setTyped({ ...typed, [field.name]: event.target.value })}
                />
              )}
            </Field>
          )
        })}
        <Field label={t.profiles.name} hint={t.profiles.nameHint}>
          {(id) => <input id={id} className="add-package__input" value={name} autoComplete="off" onChange={(event) => setName(event.target.value)} />}
        </Field>
        {fresh && <p className="profiles__ok">{t.profiles.login(checked.result.login)}</p>}
        {fresh && checked.result.duplicate !== null && <p className="notice notice--warn">{t.profiles.duplicate(checked.result.duplicate)}</p>}
        {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      </div>
      <footer className="add-package__foot">
        {onBack !== undefined && (
          <button type="button" className="button" onClick={onBack}>
            ← {t.packages.back}
          </button>
        )}
        <span className="add-package__spacer" />
        <button type="button" className="button" onClick={onClose}>
          {t.packages.cancel}
        </button>
        <button type="button" className="button" disabled={busy} onClick={() => void check()}>
          {busy ? t.profiles.checking : t.profiles.check}
        </button>
        <button type="submit" className="button button--primary" disabled={!fresh || busy}>
          {t.profiles.save}
        </button>
      </footer>
    </form>
  )
}
