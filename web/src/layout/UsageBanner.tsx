import { useState } from 'react'
import { useLive } from '../live/context.js'
import { usageNotice } from '../state.js'

const DISMISSED_KEY = 'baton.usageNotice.dismissed'

export function UsageBanner() {
  const { state } = useLive()
  const [dismissed, setDismissed] = useState(readDismissed)
  const notice = state === null ? null : usageNotice(state.usage)
  if (notice === null || notice.key === dismissed) return null

  const dismiss = () => {
    setDismissed(notice.key)
    try {
      localStorage.setItem(DISMISSED_KEY, notice.key)
    } catch {}
  }

  return (
    <div className={`banner banner--${notice.tone}`} role="alert">
      <div className="banner__inner">
        <span>{notice.text}</span>
        <button type="button" className="button" onClick={dismiss}>
          Скрыть
        </button>
      </div>
    </div>
  )
}

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY)
  } catch {
    return null
  }
}
