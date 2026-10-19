import { useState } from 'react'
import type { CliVersionView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'

const DISMISSED_KEY = 'even-keel.cliVersions.dismissed'

/**
 * A CLI on a version Even Keel was not checked against (BTN-249), or a daemon on another version than the pin (BTN-250);
 * closed, it stays hidden until that version changes.
 */
export function CliVersionBanner() {
  const { state } = useLive()
  const [dismissed, setDismissed] = useState(readDismissed)
  const shown = (state?.cliVersions ?? []).filter((each) => dismissed[keyOf(each)] !== each.installed)
  if (shown.length === 0) return null

  const dismiss = () => {
    const next = { ...dismissed, ...Object.fromEntries(shown.map((each) => [keyOf(each), each.installed])) }
    setDismissed(next)
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next))
    } catch {}
  }

  return (
    <div className="banner banner--warn" role="alert">
      <div className="banner__inner">
        <span>
          {shown.map((each, index) => (
            <span key={keyOf(each)}>
              {index > 0 && <br />}
              {say(each.notice)}
            </span>
          ))}
        </span>
        <button type="button" className="button" onClick={dismiss}>
          {t.common.hide}
        </button>
      </div>
    </div>
  )
}

/** The installed CLI by its agent, a daemon (BTN-250) by its agent and account. */
const keyOf = ({ agent, account }: CliVersionView): string => (account === null ? agent : `${agent}/${account}`)

/** The installed version whose banner was closed, by `keyOf`. */
function readDismissed(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '{}')
    return typeof value === 'object' && value !== null ? (value as Record<string, string>) : {}
  } catch {
    return {}
  }
}
