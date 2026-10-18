import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { EvenKeelState, ProfileView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { PlusIcon, TrackerIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import { ProfileDialog } from './ProfileDialog.js'
import { daysLeft } from './profileForm.js'
import './accounts.css'
import './profiles.css'

const EXPIRY_WARN_DAYS = 14

/** Which dialog is up: a new profile, or the profile of that id. */
type Editing = { id: string | null } | null

/** The trackers' profiles of the "Access" tab: a card each, the details on pointing, and "Add profile". */
export function SettingsProfiles({ state }: { state: EvenKeelState }) {
  const [editing, setEditing] = useState<Editing>(null)
  const { profiles, kinds } = state.profiles
  return (
    <section className="secrets__group profiles">
      <div className="profiles__head">
        <h3 className="secrets__title">{t.profiles.title}</h3>
        <button type="button" className="button button--small" aria-haspopup="dialog" onClick={() => setEditing({ id: null })}>
          <PlusIcon />
          {t.profiles.add}
        </button>
      </div>
      <p className="settings__hint">{t.profiles.hint}</p>
      {profiles.length === 0 ? (
        <p className="notice notice--warn">{t.profiles.none}</p>
      ) : (
        <ul className="account-cards">
          {profiles.map((profile) => (
            <ProfileCard key={profile.id} profile={profile} onEdit={() => setEditing({ id: profile.id })} />
          ))}
        </ul>
      )}
      {editing !== null &&
        createPortal(<ProfileDialog kinds={kinds} profile={profiles.find((each) => each.id === editing.id)} onClose={() => setEditing(null)} />, document.body)}
    </section>
  )
}

/** What needs a look stays in sight (the state, the expiry, a refusal); whom it signs in as and its projects open on pointing. */
function ProfileCard({ profile, onEdit }: { profile: ProfileView; onEdit: () => void }) {
  const { send, sending, failure } = useCommand()
  const { state, error } = profile.check
  const look = state === 'ok' ? 'tools__chip--on' : state === 'refused' || state === 'unreachable' ? 'tools__chip--lost' : 'tools__chip--off'
  const days = profile.expiresAt === null ? null : daysLeft(profile.expiresAt, Date.now())
  const details = (
    <>
      <span className="profiles__line">{profile.login === null ? t.profiles.states.unchecked : t.profiles.login(profile.login)}</span>
      <span className="profiles__line">{profile.projects.length === 0 ? t.profiles.noProjects : t.profiles.projects(profile.projects.join(', '))}</span>
      {profile.hiddenCi.length > 0 && (
        <span className="profiles__line">{t.profiles.hiddenCi(profile.hiddenCi.map((each) => `${each.project} · ${each.remote}`).join(', '))}</span>
      )}
    </>
  )

  return (
    <li className={`account-card-item profile-card profile-card--${state}`}>
      <div className="profile-card__head">
        <span className="profile-card__icon">
          <TrackerIcon kind={profile.kind} />
        </span>
        <Tipped className="profile-card__name" tip={details} align="start" focusable>
          {profile.name}
        </Tipped>
      </div>
      <div className="secrets__state">
        <span className={`tools__chip ${look}`}>{t.profiles.states[state]}</span>
        {profile.isDefault && <span className="tools__chip tools__chip--hidden">{t.profiles.isDefault}</span>}
        {days !== null && <span className={`tools__chip ${days <= EXPIRY_WARN_DAYS ? 'tools__chip--lost' : 'tools__chip--off'}`}>{t.profiles.expires(days)}</span>}
        {profile.hiddenCi.length > 0 && (
          <Tipped tip={details} focusable inline>
            <span className="tools__chip tools__chip--ask">{t.profiles.ciHidden}</span>
          </Tipped>
        )}
      </div>
      {error !== null && state !== 'ok' && <p className="notice notice--error profiles__error">{say(error)}</p>}
      {failure !== null && <p className="notice notice--error profiles__error">{say(failure)}</p>}
      <div className="account-card-item__foot">
        <button type="button" className="button button--small" aria-haspopup="dialog" disabled={sending} onClick={onEdit}>
          {t.profiles.edit}
        </button>
        {!profile.isDefault && (
          <button type="button" className="button button--small" disabled={sending} onClick={() => void send('profiles/default', { id: profile.id })}>
            {t.profiles.makeDefault}
          </button>
        )}
        <button type="button" className="button button--small" disabled={sending} onClick={() => void send('profiles/remove', { id: profile.id })}>
          {t.profiles.remove}
        </button>
      </div>
    </li>
  )
}
