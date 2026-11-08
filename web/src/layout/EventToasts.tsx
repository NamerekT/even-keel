import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import type { EventEntry } from '../../../src/event-log/model.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { Toast } from '../ui/Toast.js'
import { freshAlerts, lastId, placePath, useFirstReadMark, withFresh } from './eventLog.js'
import { EventTitle } from './EventSubject.js'

/** How long a toast stays while the page is in sight; a hidden tab stops it, and coming back starts it over. */
export const TOAST_MS = 12_000

/**
 * A toast for each warning and error the service's log wrote while the page is open (BTN-350); it goes when closed,
 * opened, or after `TOAST_MS` in sight, and stays in the log (`/log`). Info goes only to the log.
 */
export function EventToasts() {
  const { state } = useLive()
  const navigate = useNavigate()
  const seen = useRef<number | null>(null)
  const [shown, setShown] = useState<EventEntry[]>([])
  useFirstReadMark(state?.eventLog)
  useEffect(() => {
    if (state === null) return
    const before = seen.current
    seen.current = lastId(state.eventLog)
    if (before === null) return
    const fresh = freshAlerts(state.eventLog, before)
    if (fresh.length > 0) setShown((now) => withFresh(now, fresh))
  }, [state])
  if (state === null || shown.length === 0) return null

  const close = (id: string) => setShown((now) => now.filter((each) => each.id !== id))
  return (
    <>
      {shown.map((entry) => {
        const path = placePath(entry.place, state)
        const open = path === null ? [] : [{ label: t.events.open, onClick: () => (close(entry.id), navigate(path)) }]
        return (
          <TimedToast key={entry.id} onTimeout={() => close(entry.id)}>
            <Toast
              source="Even Keel"
              icon="/favicon.svg"
              title={<EventTitle entry={entry} state={state} />}
              body={t.events.hints[entry.notice.code]}
              actions={[...open, { label: t.events.close, onClick: () => close(entry.id) }]}
            />
          </TimedToast>
        )
      })}
    </>
  )
}

/** Calls `onTimeout` after `TOAST_MS` of the page in sight; hiding the tab drops the count, showing it starts again. */
function TimedToast({ onTimeout, children }: { onTimeout: () => void; children: ReactNode }) {
  const done = useRef(onTimeout)
  done.current = onTimeout
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const restart = () => {
      clearTimeout(timer)
      timer = document.hidden ? undefined : setTimeout(() => done.current(), TOAST_MS)
    }
    restart()
    document.addEventListener('visibilitychange', restart)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', restart)
    }
  }, [])
  return children
}
