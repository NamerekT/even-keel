import { useState } from 'react'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { Toast } from '../ui/Toast.js'

const DISMISSED_KEY = 'even-keel.fallbacks.dismissed'

/** A toast per launch whose run label had no account in the pool; closed on this device only. */
export function FallbackToasts() {
  const { state } = useLive()
  const [dismissed, setDismissed] = useState(readDismissed)
  const shown = (state?.fallbacks ?? []).filter((each) => !dismissed.includes(keyOf(each)))
  if (shown.length === 0) return null

  const close = (key: string) => {
    // Only the keys of launches still on the page are kept: the list does not grow past a day of them.
    const next = [...dismissed.filter((each) => state!.fallbacks.some((launch) => keyOf(launch) === each)), key]
    setDismissed(next)
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next))
    } catch {}
  }
  return (
    <>
      {shown.map((launch) => (
        <Toast
          key={keyOf(launch)}
          source="Even Keel"
          icon="/favicon.svg"
          title={t.fallback.toastTitle(launch.task)}
          body={say(launch.notice)}
          actions={[{ label: t.fallback.close, onClick: () => close(keyOf(launch)) }]}
        />
      ))}
    </>
  )
}

const keyOf = ({ at, task }: { at: string; task: string }) => `${at}|${task}`

function readDismissed(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]')
    return Array.isArray(saved) ? saved.filter((each): each is string => typeof each === 'string') : []
  } catch {
    return []
  }
}
