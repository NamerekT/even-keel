import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router'
import type { EvenKeelState, ProfileView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { Band } from '../ui/blocks.js'
import { PlusIcon, TrackerIcon } from '../ui/icons.js'
import { useProjectLabel } from '../ui/ProjectLabel.js'
import { Tipped } from '../ui/Tipped.js'
import { ProfileDialog } from './ProfileDialog.js'
import { Section } from './settingsParts.js'
import { daysLeft } from './profileForm.js'
import { profileAddOf, withoutProfileAdd } from './pullFix.js'
import './profiles.css'

const EXPIRY_WARN_DAYS = 14

const remotesOf = (remotes: ProfileView['ci'], label: (project: string) => string): string =>
  remotes.map((each) => `${label(each.project)} · ${each.remote}`).join(', ')

/** Which dialog is up: a new profile, or the profile of that id. */
type Editing = { id: string | null } | null

/**
 * The "Trackers and CI" tab: a row per profile, the details on pointing, and "Add profile". A tracker's profile links to
 * its own tab of the chain rules (`onRules`).
 */
export function SettingsProfiles({ state, onRules }: { state: EvenKeelState; onRules: (id: string) => void }) {
  const [editing, setEditing] = useState<Editing>(null)
  const [params, setParams] = useSearchParams()
  const { profiles, kinds } = state.profiles
  const asked = profileAddOf(params)
  const adding = asked !== null && kinds.some((each) => each.kind === asked.kind) ? asked : null
  const add = (
    <button type="button" className="button button--small" aria-haspopup="dialog" onClick={() => setEditing({ id: null })}>
      <PlusIcon />
      {t.profiles.add}
    </button>
  )
  return (
    <Section title={t.profiles.title} hint={t.profiles.hint} aside={add}>
      {/* A profile's tracker keys also go into the global settings.json: a removed one reaches new sessions until that folder's daemon restarts. */}
      {state.secrets.sessionsPending && <Band tone="warn">{t.secrets.pending}</Band>}
      {profiles.length === 0 ? (
        <p className="notice notice--warn">{t.profiles.none}</p>
      ) : (
        <ul className="profile-rows">
          {profiles.map((profile) => (
            <ProfileRow
              key={profile.id}
              profile={profile}
              tracker={kinds.find((each) => each.kind === profile.kind)?.tracker ?? true}
              onEdit={() => setEditing({ id: profile.id })}
              onRules={() => onRules(profile.id)}
            />
          ))}
        </ul>
      )}
      {editing !== null &&
        createPortal(<ProfileDialog kinds={kinds} profile={profiles.find((each) => each.id === editing.id)} onClose={() => setEditing(null)} />, document.body)}
      {/* Only PR mode links here so far (EKR-7): the profile is for a remote's pull requests. */}
      {adding !== null &&
        editing === null &&
        createPortal(
          <ProfileDialog
            kinds={kinds}
            profile={undefined}
            fixed={adding.kind}
            host={adding.host}
            stress="pullRequests"
            onClose={() => setParams(withoutProfileAdd(params), { replace: true })}
          />,
          document.body,
        )}
    </Section>
  )
}

const LAMPS: Record<ProfileView['check']['state'], string> = {
  ok: 'lamp--done',
  refused: 'lamp--error',
  unreachable: 'lamp--error',
  checking: 'lamp--working',
  unchecked: '',
}

/**
 * A row, quiet while all is well: a lamp, the name and whether it is the default. Colour only on what needs a look —
 * a refusal, a near expiry, hidden CI, a refused pull request. Whom it signs in as and its projects open on pointing at
 * the name — a CI's profile (`tracker` off) names the remotes whose CI takes it instead.
 */
function ProfileRow({ profile, tracker, onEdit, onRules }: { profile: ProfileView; tracker: boolean; onEdit: () => void; onRules: () => void }) {
  const { send, sending, failure } = useCommand()
  const label = useProjectLabel()
  const { state, error } = profile.check
  const days = profile.expiresAt === null ? null : daysLeft(profile.expiresAt, Date.now())
  const details = (
    <>
      <span className="profiles__line">{profile.login === null ? t.profiles.states.unchecked : t.profiles.login(profile.login)}</span>
      {tracker ? (
        <span className="profiles__line">{profile.projects.length === 0 ? t.profiles.noProjects : t.profiles.projects(profile.projects.join(', '))}</span>
      ) : (
        <span className="profiles__line">{profile.ci.length === 0 ? t.profiles.noCi : t.profiles.ci(remotesOf(profile.ci, label))}</span>
      )}
      {profile.hiddenCi.length > 0 && <span className="profiles__line">{t.profiles.hiddenCi(remotesOf(profile.hiddenCi, label), profile.kind)}</span>}
      {profile.deniedPulls.length > 0 && <span className="profiles__line">{t.profiles.deniedPulls(remotesOf(profile.deniedPulls, label), profile.kind)}</span>}
    </>
  )

  return (
    <li className="profile-row">
      <div className="profile-row__head">
        <span className={`lamp ${LAMPS[state]}`} role="img" aria-label={t.profiles.states[state]} />
        <span className="profile-row__icon">
          <TrackerIcon kind={profile.kind} />
        </span>
        <Tipped className="profile-row__name" tip={details} align="start" focusable>
          {profile.name}
        </Tipped>
        {profile.isDefault && <span className="profile-row__quiet">{t.profiles.isDefault}</span>}
        {state !== 'ok' && <span className={`profile-row__state profile-row__state--${state}`}>{t.profiles.states[state]}</span>}
        {days !== null &&
          (days <= EXPIRY_WARN_DAYS ? (
            <span className="tools__chip tools__chip--lost">{t.profiles.expires(days)}</span>
          ) : (
            <span className="profile-row__quiet">{t.profiles.expires(days)}</span>
          ))}
        {profile.hiddenCi.length > 0 && (
          <Tipped tip={details} focusable inline>
            <span className="tools__chip tools__chip--ask">{t.profiles.ciHidden}</span>
          </Tipped>
        )}
        {profile.deniedPulls.length > 0 && (
          <Tipped tip={details} focusable inline>
            <span className="tools__chip tools__chip--lost">{t.profiles.pullsRefused}</span>
          </Tipped>
        )}
      </div>
      <div className="profile-row__actions">
        <button type="button" className="profile-row__action" aria-haspopup="dialog" disabled={sending} onClick={onEdit}>
          {t.profiles.edit}
        </button>
        {tracker && (
          <button type="button" className="profile-row__action" onClick={onRules}>
            {t.profiles.rules}
          </button>
        )}
        {!profile.isDefault && (
          <button type="button" className="profile-row__action" disabled={sending} onClick={() => void send('profiles/default', { id: profile.id })}>
            {t.profiles.makeDefault}
          </button>
        )}
        <button
          type="button"
          className="profile-row__action profile-row__action--remove"
          disabled={sending}
          onClick={() => void send('profiles/remove', { id: profile.id })}
        >
          {t.profiles.remove}
        </button>
      </div>
      {error !== null && state !== 'ok' && <p className="notice notice--error profiles__error">{say(error)}</p>}
      {failure !== null && <p className="notice notice--error profiles__error">{say(failure)}</p>}
    </li>
  )
}
