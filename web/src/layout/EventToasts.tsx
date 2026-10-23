import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { CI_HASH } from '../pages/CiChip.js'
import { projectPath } from '../state.js'
import { ProjectLinks } from '../ui/ProjectLinks.js'
import { Toast } from '../ui/Toast.js'
import { freshEvents, pageEvents, type PageEvent } from './pageEvents.js'

/**
 * A toast for each event that came while the page is open (`pageEvents`); it goes when closed, opened, or once the
 * event is over. The state itself stays on the card: the toast only points at it.
 */
export function EventToasts() {
  const { state } = useLive()
  const navigate = useNavigate()
  const seen = useRef<Set<string> | null>(null)
  const [shown, setShown] = useState<PageEvent[]>([])
  useEffect(() => {
    if (state === null) return
    const events = pageEvents(state)
    const keys = new Set(events.map((each) => each.key))
    const fresh = freshEvents(seen.current, events)
    seen.current = keys
    setShown((now) => {
      const kept = now.filter((each) => keys.has(each.key))
      return fresh.length === 0 && kept.length === now.length ? now : [...kept, ...fresh]
    })
  }, [state])
  if (state === null || shown.length === 0) return null

  const close = (key: string) => setShown((now) => now.filter((each) => each.key !== key))
  return (
    <>
      {shown.map((event) => {
        const { title, body } = textOf(event)
        return (
          <Toast
            key={event.key}
            source="Even Keel"
            icon="/favicon.svg"
            title={<ProjectLinks text={title} />}
            body={body}
            actions={[
              {
                label: t.events.open,
                onClick: () => {
                  close(event.key)
                  navigate(placeOf(event, state))
                },
              },
              { label: t.events.close, onClick: () => close(event.key) },
            ]}
          />
        )
      })}
    </>
  )
}

/** The title names its projects by their ids, shown through `ProjectLinks`. */
function textOf(event: PageEvent): { title: string; body: string } {
  if (event.kind === 'limit') return { title: t.events.limit(event.project), body: t.events.limitBody }
  if (event.kind === 'red') return { title: t.events.red(event.project), body: t.events.redBody(event.commit) }
  if (event.kind === 'ask') return { title: t.events.ask(event.task), body: t.events.askBody }
  return { title: t.events.conflict(event.project, event.into), body: t.events.conflictBody }
}

function placeOf(event: PageEvent, state: EvenKeelState): { pathname: string; hash?: string } {
  if (event.kind === 'ask') return event.project === null ? { pathname: '/' } : { pathname: projectPath(event.project), hash: event.task }
  if (event.kind === 'red' && state.ci[event.project] !== undefined) return { pathname: projectPath(event.project), hash: CI_HASH }
  return { pathname: projectPath(event.project) }
}
