import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import type { EventEntry } from '../../../src/event-log/model.js'
import type { EvenKeelState } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { Toast, ToastList, useToastTimer } from '../ui/Toast.js'
import { freshAlerts, lastId, placePath, useFirstReadMark, withFresh } from './eventLog.js'
import { EventTitle } from './EventSubject.js'
import { toastOf } from './eventToast.js'

/**
 * How long a toast stays while the page is in sight and nothing holds it: a hidden tab stops it, and coming back
 * starts it over; a pointer over it or the focus inside stops it, and it goes on from the same place (BTN-845).
 */
export const TOAST_MS = 12_000

/**
 * A toast for each warning and error the service's log wrote while the page is open (BTN-350); it goes when closed,
 * opened, or after `TOAST_MS` in sight, and stays in the log (`/log`). Info goes only to the log.
 */
export function EventToasts() {
  const { state } = useLive()
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

  const close = (id: string) => setShown((now) => now.filter((each) => each.id !== id))
  const items = state === null ? [] : shown.map((entry) => ({ key: entry.id, children: <EventToast entry={entry} state={state} onClose={() => close(entry.id)} /> }))
  return <ToastList items={items} />
}

function EventToast({ entry, state, onClose }: { entry: EventEntry; state: EvenKeelState; onClose: () => void }) {
  const navigate = useNavigate()
  const timer = useToastTimer(TOAST_MS, onClose)
  const path = placePath(entry.place, state)
  const text = toastOf(entry)
  const open = path === null ? [] : [{ label: t.events.open, onClick: () => (onClose(), navigate(path)) }]
  return (
    <Toast
      source="Even Keel"
      icon="/favicon.svg"
      title={<EventTitle text={text} state={state} />}
      body={text.body}
      actions={[...open, { label: t.events.close, onClick: onClose }]}
      timer={timer}
    />
  )
}
