import { useState } from 'react'
import { createPortal } from 'react-dom'
import { BUILTIN } from '../../../src/builtin/model.js'
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
 * The setup's tracker (BTN-346): the built-in tracker first, with nothing to connect (BTN-769), then a card per
 * tracker the adapters know, with its profiles and their state, and "Connect" or "Add another", which opens the
 * profile dialog on that tracker at once.
 */
export function TrackerStep({ state }: { state: EvenKeelState }) {
  const [open, setOpen] = useState<{ kind: string; profile?: ProfileView } | null>(null)
  const kinds = state.profiles.kinds.filter((kind) => kind.tracker)
  const added = trackerProfiles(state)
  return (
    <>
      <p className="setup__lead">{t.setup.trackerLead}</p>
      <ul className="setup-trackers">
        <li className="setup-tracker">
          <span className="setup-tracker__head">
            <TrackerIcon kind={BUILTIN} />
            {t.profiles.builtin}
          </span>
          <span className="setup-tracker__note">{t.profiles.builtinNote}</span>
        </li>
        {kinds.map((kind) => {
          const has = added.some((profile) => profile.kind === kind.kind)
          return (
            <li key={kind.kind} className="setup-tracker">
              <span className="setup-tracker__head">
                <TrackerIcon kind={kind.kind} />
                {kind.title}
              </span>
              <button type="button" className="button button--small setup-tracker__add" aria-haspopup="dialog" onClick={() => setOpen({ kind: kind.kind })}>
                <PlusIcon />
                {has ? t.setup.addAnother : t.setup.connect}
              </button>
            </li>
          )
        })}
      </ul>
      {added.length > 0 && (
        <table className="setup-accounts setup-profiles">
          <tbody>
            {added.map((profile) => {
              const title = kinds.find((kind) => kind.kind === profile.kind)?.title ?? profile.kind
              return (
                <tr key={profile.id}>
                  <td className="setup-accounts__name setup-profiles__name">{profileShortName(profile.name, title)}</td>
                  <td className="setup-profiles__kind">
                    <TrackerIcon kind={profile.kind} />
                    {title}
                  </td>
                  <td className="setup-accounts__state">
                    <ProfileState profile={profile} />
                    {(profile.check.state === 'refused' || profile.check.state === 'unreachable') && (
                      <button type="button" className="button button--small" aria-haspopup="dialog" onClick={() => setOpen({ kind: profile.kind, profile })}>
                        {t.profiles.edit}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {open !== null && createPortal(<ProfileDialog kinds={kinds} profile={open.profile} fixed={open.kind} onClose={() => setOpen(null)} />, document.body)}
    </>
  )
}
