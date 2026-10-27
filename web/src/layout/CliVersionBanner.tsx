import { useState } from 'react'
import type { CliVersionView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { cliSummary } from './cliVersions.js'
import { Banner } from './Banner.js'

const DISMISSED_KEY = 'even-keel.cliVersions.dismissed'

/**
 * A CLI on a version Even Keel was not checked against (BTN-249), or a daemon on another version than the pin (BTN-250);
 * one folded line, each CLI's notice under "Details" (BTN-349, open until a reload); closed, it stays hidden until that
 * version changes.
 */
export function CliVersionBanner() {
  const { state } = useLive()
  const [dismissed, setDismissed] = useState(readDismissed)
  const [open, setOpen] = useState(false)
  const shown = (state?.cliVersions ?? []).filter((each) => dismissed[keyOf(each)] !== each.installed)
  if (shown.length === 0) return <Banner />

  const dismiss = () => {
    const next = { ...dismissed, ...Object.fromEntries(shown.map((each) => [keyOf(each), each.installed])) }
    setDismissed(next)
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next))
    } catch {}
  }

  return (
    <Banner tone="warn">
      <div className="banner__inner">
        <span>{cliSummary(shown)}</span>
        <span className="banner__actions">
          <button type="button" className="banner__toggle" aria-expanded={open} aria-controls="cli-versions" onClick={() => setOpen(!open)}>
            {t.banner.cliDetails}
            <svg className="banner__chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <path d="M2.5 4.5 6 8l3.5-3.5" />
            </svg>
          </button>
          <button type="button" className="button" onClick={dismiss}>
            {t.common.hide}
          </button>
        </span>
        {open && (
          <ul className="banner__list" id="cli-versions">
            {shown.map((each) => (
              <li key={keyOf(each)}>{say(each.notice)}</li>
            ))}
          </ul>
        )}
      </div>
    </Banner>
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
