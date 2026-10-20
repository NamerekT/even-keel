import { useNavigate } from 'react-router'
import { FORGES } from '../../../src/notice/en.js'
import type { Notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { projectPath } from '../state.js'
import { Tipped } from '../ui/Tipped.js'
import { profileAddPath, pullFixOf } from './pullFix.js'
import { openTab, projectScope, SETTINGS_HASH } from './settingsStore.js'

/** Why PR mode has nowhere to open pull requests, under its switch (EKR-7); a warning while the mode is on. */
export function PullHint({ readiness, on }: { readiness: Notice | null; on: boolean }) {
  if (readiness === null) return null
  return <span className={on ? 'settings__error' : 'settings__hint'}>{hintOf(readiness)}</span>
}

function hintOf(readiness: Notice): string {
  if (readiness.code === 'review.noRemote') return t.settings.pullNoRemote
  if (readiness.code === 'review.unsupportedHost') return t.settings.pullUnsupported(readiness.params.host)
  if (readiness.code === 'review.noToken') return t.settings.pullNoToken(FORGES[readiness.params.kind], readiness.params.remote)
  return say(readiness)
}

/** "Add profile" beside PR mode's switch: active only while no profile has a token for the remote of the pull requests. */
export function AddPullProfile({ readiness }: { readiness: Notice | null }) {
  const navigate = useNavigate()
  const fix = pullFixOf(readiness)
  const profile = fix?.fix === 'profile' ? fix : null
  return (
    <Tipped tip={profile === null ? t.settings.pullProfileIdle : t.settings.pullAddProfileTip(FORGES[profile.kind], profile.web)} inline>
      <button type="button" className="button button--small" aria-disabled={profile === null} onClick={() => profile !== null && navigate(profileAddPath(profile.kind, profile.web))}>
        {t.settings.pullAddProfile}
      </button>
    </Tipped>
  )
}

/** What a chain paused for PR mode with nowhere to go is fixed by, under its plaque: a profile, or a remote in the project's settings. */
export function PullFixButton({ state, project, error }: { state: EvenKeelState; project: string; error: Notice | null }) {
  const navigate = useNavigate()
  const fix = pullFixOf(error)
  if (fix === null) return null
  const go =
    fix.fix === 'profile'
      ? () => navigate(profileAddPath(fix.kind, fix.web))
      : () => {
          openTab(projectScope(project), 'ci')
          navigate({ pathname: projectPath(state, project), hash: SETTINGS_HASH })
        }
  return (
    <button type="button" className="button button--small pull-fix" onClick={go}>
      {fix.fix === 'profile' ? t.settings.pullAddProfile : t.project.pullAddRemote}
    </button>
  )
}
