import { useState } from 'react'
import type { CliCheckView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { Banner } from './Banner.js'

const DISMISSED_KEY = 'even-keel.cliChecks.dismissed'

/**
 * The automatic CLI check of each agent (BTN-569): waiting for a free account folder, running, or its last result, a
 * failure with the step that failed. Closed, a check stays hidden until it moves on.
 */
export function CliCheckBanner() {
  const { state } = useLive()
  const [dismissed, setDismissed] = useState(readDismissed)
  const shown = (state?.cliChecks ?? []).filter((each) => dismissed[each.agent] !== stampOf(each))
  if (shown.length === 0) return <Banner />

  const dismiss = () => {
    const next = { ...dismissed, ...Object.fromEntries(shown.map((each) => [each.agent, stampOf(each)])) }
    setDismissed(next)
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next))
    } catch {}
  }

  const failed = shown.some((each) => each.notice.code === 'cliCheck.failed')
  const settled = shown.every((each) => each.notice.code === 'cliCheck.passed' || each.notice.code === 'cliCheck.running')
  return (
    <Banner tone={failed ? 'error' : undefined} role={settled ? 'status' : 'alert'}>
      <div className="banner__inner">
        {shown.length === 1 ? (
          <span>{say(shown[0]!.notice)}</span>
        ) : (
          <div>
            <ul className="banner__list">
              {shown.map((each) => (
                <li key={each.agent}>{say(each.notice)}</li>
              ))}
            </ul>
          </div>
        )}
        <span className="banner__actions">
          <button type="button" className="button" onClick={dismiss}>
            {t.common.hide}
          </button>
        </span>
      </div>
    </Banner>
  )
}

/** A check is the same while its notice and moment are. */
const stampOf = (view: CliCheckView): string => `${view.notice.code}@${view.at}`

function readDismissed(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '{}')
    return typeof value === 'object' && value !== null ? (value as Record<string, string>) : {}
  } catch {
    return {}
  }
}
