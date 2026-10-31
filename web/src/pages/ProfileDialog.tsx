import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import type { CheckResult, ProfileKindView, ProfileView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import type { RightsUse } from '../i18n/ru.js'
import { useLive } from '../live/context.js'
import { Field } from '../tools/AddPackage.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { SectionLabel } from '../ui/blocks.js'
import { TrackerIcon } from '../ui/icons.js'
import { stillMotion } from '../ui/landing.js'
import { secretInput } from '../ui/secret.js'
import { alternativeOf, draftValues, hostValues, trackerFields, unfilled } from './profileForm.js'
import { ProfileMcp, type GrantChoice } from './ProfileMcp.js'
import { ProfileMovesStep } from './ProfileMovesStep.js'
import './profiles.css'

interface DialogProps {
  kinds: ProfileKindView[]
  /** The profile to edit; none — a new one. */
  profile: ProfileView | undefined
  /** The use the dialog is opened for, its rights stand out: pull requests from PR mode's notices (EKR-7). */
  stress?: RightsUse
  /** The kind of a new profile, fixed: a remote's forge asks for its own (EKR-7). */
  fixed?: string
  /** The server's address a new profile starts with, in the kind's host field (Forgejo's URL). */
  host?: string
  onClose: () => void
  /** The id of the profile saved, before the dialog closes. */
  onSaved?: (id: string) => void
}

/** "Add profile" and a profile's edit: the kind's tiles first for a new one, then its fields, Check, and Check and save. */
export function ProfileDialog({ kinds, profile, stress, fixed, host, onClose, onSaved }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [grant, setGrant] = useState<GrantChoice>(undefined)
  const discard = (action: () => void) => {
    if (grant != null && !window.confirm(t.profiles.mcp.discard)) return
    setGrant(undefined)
    action()
  }
  const close = () => discard(onClose)
  const backdrop = useBackdropClose(dialog, close)
  const [kind, setKind] = useState<string | null>(profile?.kind ?? fixed ?? null)
  const [gitlabHost, setGitlabHost] = useState<string | null>(null)
  const [added, setAdded] = useState<{ id: string; name: string } | null>(null)
  const activeProfile = gitlabHost === null ? profile : undefined
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
        close()
      }}
      {...backdrop}
    >
      <div className="add-package__frame">
        <header className="add-package__head">
          <h2 id={title} className="add-package__title">
            {activeProfile !== undefined ? t.profiles.editTitle(activeProfile.name) : view === undefined ? t.profiles.add : `${t.profiles.add} · ${view.title}`}
          </h2>
          <button type="button" className="panel__close" aria-label={t.packages.close} onClick={close}>
            ×
          </button>
        </header>
        {added !== null ? (
          <ProfileMovesStep id={added.id} name={added.name} onClose={onClose} />
        ) : view === undefined ? (
          <KindStep kinds={kinds} onPick={setKind} />
        ) : (
          <FieldsStep
            key={view.kind}
            kind={view}
            profile={activeProfile}
            stress={stress}
            host={gitlabHost ?? host}
            onBack={activeProfile === undefined && fixed === undefined ? () => discard(() => { setGitlabHost(null); setKind(null) }) : undefined}
            onGitlab={kinds.some((each) => each.kind === 'gitlab') ? (address) => discard(() => { setGitlabHost(address); setKind('gitlab') }) : undefined}
            onClose={close}
            // A new profile of a tracker that moves statuses asks for its moves next (BTN-554).
            onFinish={(id, name) => (activeProfile === undefined && view.moves === true ? setAdded({ id, name }) : onClose())}
            grant={grant}
            onGrant={setGrant}
            onSaved={onSaved}
          />
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
  grant: GrantChoice
  onGrant: (grant: GrantChoice) => void
  onFinish: (id: string, name: string) => void
  kind: ProfileKindView
  profile: ProfileView | undefined
  stress: RightsUse | undefined
  host: string | undefined
  /** None for an edit: the kind of a stored profile stays. */
  onBack: (() => void) | undefined
  onGitlab: ((address: string) => void) | undefined
  onClose: () => void
  onSaved: ((id: string) => void) | undefined
}

interface Checked {
  /** The values the check was of: unchanged fields can reuse its result. */
  values: string
  result: CheckResult
}

const USES: RightsUse[] = ['tracker', 'ci', 'pullRequests']

const fieldLabel = (name: string): string => t.profiles.fieldLabels[name] ?? t.secrets.purpose[name] ?? name

/** What the token needs, a line per use the kind has; the use the dialog was opened for stands out. */
function Rights({ kind, stress }: { kind: ProfileKindView; stress: RightsUse | undefined }) {
  const rights = t.profiles.rights[kind.kind] ?? {}
  const uses = USES.filter((use) => rights[use] !== undefined)
  return (
    <div className="settings__hint profile-rights">
      <p className="profile-rights__intro">
        {t.profiles.rightsIntro[kind.kind] ?? ''}{' '}
        <a href={kind.help} target="_blank" rel="noreferrer">
          {t.profiles.howTo}
        </a>
      </p>
      <ul className="profile-rights__list">
        {uses.map((use) => (
          <li key={use} className={use === stress ? 'profile-rights__use profile-rights__use--stressed' : 'profile-rights__use'}>
            <span className="profile-rights__name">{t.profiles.rightsUse[use]}:</span> {rights[use]}
            {use === 'pullRequests' && <span className="profile-rights__note">{t.profiles.pushedByGit}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function FieldsStep({ kind, profile, stress, host, onBack, onGitlab, onClose, onFinish, onSaved, grant, onGrant }: FieldsProps) {
  const { query } = useLive()
  const [alternative, setAlternative] = useState(() => alternativeOf(kind, profile))
  const [typed, setTyped] = useState<Record<string, string>>(() =>
    profile === undefined
      ? hostValues(kind, host)
      : Object.fromEntries(profile.fields.filter((field) => field.value !== null).map((field) => [field.name, field.value!])),
  )
  const [name, setName] = useState(profile?.name ?? '')
  const [checked, setChecked] = useState<Checked | null>(null)
  const [failure, setFailure] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  /** A check was pressed with blank fields: the server could only say the fields are not filled, the page names them. */
  const [asked, setAsked] = useState(false)
  const blank = unfilled(kind, alternative, typed, profile).map(fieldLabel)
  const values = draftValues(kind, alternative, typed)
  const key = JSON.stringify(values)
  const checkKey = JSON.stringify([values, grant])
  const fresh = checked !== null && checked.values === checkKey
  const hostLocked = (profile?.projects.length ?? 0) > 0
  const draft = { kind: kind.kind, values, ...(profile === undefined ? {} : { id: profile.id }) }
  const oauth = grant === null ? { oauth: null } : grant !== undefined && grant.values === key ? { oauth: grant.flow } : {}
  const body = useRef<HTMLDivElement>(null)
  const granted = grant != null && grant.values === key ? grant.flow : null
  const mcpWarning = fresh ? checked.result.mcpWarning : grant === undefined ? profile?.mcpOAuth?.warning : undefined

  // The "Signed in as" line lands under the fold of a short screen: bring it into view (BTN-592).
  useEffect(() => {
    const box = body.current
    if (checked === null || box === null) return
    box.scrollTo({ top: box.scrollHeight, behavior: stillMotion() ? 'auto' : 'smooth' })
  }, [checked])

  const run = async <T,>(action: () => Promise<T>): Promise<T | null> => {
    if (blank.length > 0) {
      setAsked(true)
      setFailure(null)
      return null
    }
    setBusy(true)
    setFailure(null)
    try {
      return await action()
    } catch (error) {
      setFailure(noticeOf(error))
      return null
    } finally {
      setBusy(false)
    }
  }

  const check = async () => {
    setChecked(null)
    const result = await query<CheckResult>('profiles/check', { ...draft, ...oauth })
    setChecked({ values: checkKey, result })
    if (name.trim() === '' || name === checked?.result.name) setName(result.name)
    return result
  }

  // A new grant is checked at once: Atlassian gives it to whoever is signed in in the browser, perhaps not the tracker's person (BTN-590).
  useEffect(() => {
    if (granted !== null) void run(check)
  }, [granted])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const saved = await run(async () => {
      const result = fresh ? checked.result : await check()
      if (!fresh && result.duplicate !== null) return null
      const saveName = name.trim() === '' || name === checked?.result.name ? result.name : name.trim()
      return { ...(await query<{ id: string }>('profiles/save', { ...draft, ...oauth, name: saveName })), name: saveName }
    })
    if (saved === null) return
    onSaved?.(saved.id)
    onFinish(saved.id, saved.name)
  }

  return (
    <form className="add-package__form profile-form" onSubmit={(event) => void save(event)}>
      <div ref={body} className="add-package__body" inert={busy}>
        <Rights kind={kind} stress={stress} />
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
        {trackerFields(kind, alternative).map((field) => {
          const stored = profile?.fields.find((each) => each.name === field.name)
          const locked = hostLocked && kind.hostVariables.includes(field.name)
          return (
            <Field
              key={field.name}
              label={fieldLabel(field.name)}
              hint={locked ? t.profiles.hostLocked : t.profiles.fieldHints[field.name] ? `${t.profiles.fieldHints[field.name]} (${field.name})` : field.name}
            >
              {(id) => (
                <input
                  id={id}
                  className="add-package__input add-package__input--mono"
                  {...secretInput(field.secret)}
                  value={typed[field.name] ?? ''}
                  placeholder={field.secret && stored?.set === true ? t.profiles.kept : (t.profiles.examples[field.name] ?? '')}
                  disabled={locked}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setTyped({ ...typed, [field.name]: event.target.value })}
                />
              )}
            </Field>
          )
        })}
        {kind.mcpOAuth === true && <ProfileMcp kind={kind} profile={profile} body={draft} values={key} blank={blank} grant={grant} onGrant={onGrant} warning={mcpWarning}>
          <Field label={t.profiles.fieldLabels.JIRA_MCP_TOKEN!} hint={t.profiles.fieldHints.JIRA_MCP_TOKEN}>
            {(id) => <input id={id} className="add-package__input add-package__input--mono" {...secretInput()}
              value={typed.JIRA_MCP_TOKEN ?? ''}
              placeholder={profile?.fields.some((field) => field.name === 'JIRA_MCP_TOKEN' && field.set) ? t.profiles.kept : ''}
              onChange={(event) => setTyped({ ...typed, JIRA_MCP_TOKEN: event.target.value })} />}
          </Field>
        </ProfileMcp>}
        {kind.mcpShared === true && (
          <section className="profile-mcp" aria-label={t.profiles.mcp.title}>
            <SectionLabel>{t.profiles.mcp.title}</SectionLabel>
            <p className="settings__hint profile-mcp__hint">{t.profiles.mcp.sharedToken}</p>
          </section>
        )}
        <Field label={t.profiles.name} hint={t.profiles.nameHint}>
          {(id) => <input id={id} className="add-package__input" value={name} autoComplete="off" onChange={(event) => setName(event.target.value)} />}
        </Field>
        {fresh && <p className="profiles__ok">{t.profiles.login(checked.result.login)}{kind.mcpOAuth === true && (grant === undefined ? profile?.mcpOAuth !== undefined : grant !== null && grant.values === key) ? ` · ${t.profiles.mcp.checked}` : ''}</p>}
        {fresh && checked.result.duplicate !== null && <p className="notice notice--warn">{t.profiles.duplicate(checked.result.duplicate)}</p>}
        {asked && blank.length > 0 && <p className="notice notice--error">{t.profiles.unfilled(blank)}</p>}
        {failure !== null && <div className="notice notice--error">{say(failure)}
          {(failure.code === 'jira.mcpSite' || failure.code === 'jira.mcpToken') && <p><a href="https://id.atlassian.com/manage-profile/security/api-tokens?autofillToken&appId=mcp-v2&selectedScopes=all" target="_blank" rel="noreferrer">{t.profiles.createMcpToken}</a></p>}
          {failure.code === 'profiles.isGitlab' && onGitlab !== undefined && <p><button type="button" className="button button--small" onClick={() => onGitlab(typed.FORGEJO_URL ?? '')}>{t.profiles.addGitlab}</button></p>}</div>}
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
        <button type="button" className="button" disabled={busy} onClick={() => void run(check)}>
          {t.profiles.check}
        </button>
        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? t.profiles.checking : t.profiles.save}
        </button>
      </footer>
    </form>
  )
}
