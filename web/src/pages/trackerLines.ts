import type { ProfileView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import type { StripLine } from '../ui/fieldStripFit.js'
import { daysLeft } from './profileForm.js'

/** Whom the profile signs in as, or why it does not. */
export function profileLine(profile: ProfileView, now: number): StripLine {
  const { state, error } = profile.check
  if (profile.expiresAt !== null && daysLeft(profile.expiresAt, now) <= 0) return { tone: 'error', text: t.profiles.expires(0) }
  if (state === 'ok')
    return profile.login === null ? { tone: 'ok', text: t.profiles.states.ok } : { tone: 'ok', text: t.wizard.signedIn(profile.login), short: profile.login }
  if (error !== null && (state === 'refused' || state === 'unreachable')) return { tone: 'error', text: say(error) }
  return { tone: 'plain', text: t.profiles.states[state] }
}

interface ProjectAnswers {
  /** The tracker has no project by the typed value. */
  absent: string | null
  /** The list failed while nothing else confirms the typed value. */
  alert: string | null
  /** A check's answer (the wizard's). */
  status: StripLine | null
  /** The name of the project the typed value is. */
  name: string | null
  /** The list failed, but the value stands without it. */
  quiet: boolean
}

/** The one line under the tracker project: what is wrong first, then the check's answer, then the project's name. */
export function projectLine({ absent, alert, status, name, quiet }: ProjectAnswers): StripLine | null {
  if (absent !== null) return { tone: 'error', text: absent }
  if (alert !== null) return { tone: 'error', text: alert }
  if (status !== null) return status
  if (name !== null) return { tone: 'plain', text: name }
  return quiet ? { tone: 'plain', text: t.wizard.suggestionsFailed } : null
}
