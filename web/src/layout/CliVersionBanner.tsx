import { useState } from 'react'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'

const DISMISSED_KEY = 'even-keel.cliVersions.dismissed'

/** A CLI on a version Even Keel was not checked against (BTN-249); closed, it stays hidden until that version changes. */
export function CliVersionBanner() {
  const { state } = useLive()
  const [dismissed, setDismissed] = useState(readDismissed)
  const shown = (state?.cliVersions ?? []).filter((each) => dismissed[each.agent] !== each.installed)
  if (shown.length === 0) return null

  const dismiss = () => {
    const next = { ...dismissed, ...Object.fromEntries(shown.map((each) => [each.agent, each.installed])) }
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
            <span key={each.agent}>
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

/** The installed version whose banner was closed, by agent. */
function readDismissed(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '{}')
    return typeof value === 'object' && value !== null ? (value as Record<string, string>) : {}
  } catch {
    return {}
  }
}
