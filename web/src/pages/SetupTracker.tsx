import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { EvenKeelState, ProfileView } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { PlusIcon, TrackerIcon } from '../ui/icons.js'
import { ProfileDialog } from './ProfileDialog.js'
import { profileShortName } from './setupSteps.js'
import { ProfileState } from './TrackerFields.js'

export const trackerProfiles = (state: EvenKeelState) => {
  const kinds = state.profiles.kinds.filter((kind) => kind.tracker)
  return state.profiles.profiles.filter((profile) => kinds.some((kind) => kind.kind === profile.kind))
}

/**
 * The setup's tracker (BTN-346): a card per tracker the adapters know, with its profiles and their state, and
 * "Connect" or "Add another", which opens the profile dialog on that tracker at once.
 */
export function TrackerStep({ state }: { state: EvenKeelState }) {
  const [open, setOpen] = useState<{ kind: string; profile?: ProfileView } | null>(null)
  const kinds = state.profiles.kinds.filter((kind) => kind.tracker)
  return (
    <>
      <p className="setup__lead">{t.setup.trackerLead}</p>
      <ul className="setup-trackers">
        {kinds.map((kind) => {
          const profiles = state.profiles.profiles.filter((profile) => profile.kind === kind.kind)
          return (
            <li key={kind.kind} className="setup-tracker">
              <span className="setup-tracker__head">
                <TrackerIcon kind={kind.kind} />
                {kind.title}
              </span>
              {profiles.length > 0 && (
                <ul className="setup-tracker__profiles">
                  {profiles.map((profile) => (
                    <li key={profile.id}>
                      <span className="setup-tracker__name">{profileShortName(profile.name, kind.title)}</span>
                      <ProfileState profile={profile} />
                      {(profile.check.state === 'refused' || profile.check.state === 'unreachable') && (
                        <button type="button" className="button button--small" aria-haspopup="dialog" onClick={() => setOpen({ kind: kind.kind, profile })}>
                          {t.profiles.edit}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" className="button button--small setup-tracker__add" aria-haspopup="dialog" onClick={() => setOpen({ kind: kind.kind })}>
                <PlusIcon />
                {profiles.length === 0 ? t.setup.connect : t.setup.addAnother}
              </button>
            </li>
          )
        })}
      </ul>
      {open !== null && createPortal(<ProfileDialog kinds={kinds} profile={open.profile} fixed={open.kind} onClose={() => setOpen(null)} />, document.body)}
    </>
  )
}
