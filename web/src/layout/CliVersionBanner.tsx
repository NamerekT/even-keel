import { useId, useState } from 'react'
import type { CliVersionView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { cliSummary } from './cliVersions.js'
import { useCheckedSwitch } from './CliSource.js'
import { cliText } from './cliText.js'
import { FoldBody, FoldToggle } from '../ui/Fold.js'
import { Banner } from './Banner.js'

const DISMISSED_KEY = 'even-keel.cliVersions.dismissed'

/**
 * A CLI sessions run on at a version Even Keel was not checked against (BTN-249, BTN-593), or a daemon on another version than the pin (BTN-250);
 * one folded line, each CLI's notice under "Details" (BTN-349, open until a reload); closed, it stays hidden until that
 * version changes.
 */
export function CliVersionBanner() {
  const { state } = useLive()
  const [dismissed, setDismissed] = useState(readDismissed)
  const [open, setOpen] = useState(false)
  const id = useId()
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
          <FoldToggle className="banner__toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
            {t.banner.cliDetails}
          </FoldToggle>
          <button type="button" className="button" onClick={dismiss}>
            {t.common.hide}
          </button>
        </span>
        <FoldBody id={id} open={open} className="banner__details">
          <ul className="banner__list">
            {shown.map((each) => (
              <li key={keyOf(each)}>
                {say(each.notice)}
                {each.account === null && state?.cliCopies?.[each.agent]?.source === 'system' && <CheckedSwitch provider={each.agent} />}
              </li>
            ))}
          </ul>
        </FoldBody>
      </div>
    </Banner>
  )
}

/** The installed CLI's way back to the version Even Keel was checked against (BTN-603): the same consent as the settings. */
function CheckedSwitch({ provider }: { provider: string }) {
  const { pick, dialog, sending, failure } = useCheckedSwitch(provider)
  return (
    <>
      {' '}
      <button type="button" className="button button--small" disabled={sending} onClick={pick}>
        {cliText().switch}
      </button>
      {failure !== null && <span className="settings__error">{say(failure)}</span>}
      {dialog}
    </>
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
