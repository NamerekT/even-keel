import { useEffect, useRef } from 'react'

/** `hidden` — the tab went out of sight or is closing, the page may live on; `unmount` — the field left the page. */
export type Leaving = 'hidden' | 'unmount'

/**
 * Calls `flush` when an unsaved field is about to be lost (BTN-1027): the card closed or turned to another task, or the
 * tab is hidden or closed. Both `visibilitychange` and `pagehide` may come for one close: `flush` sends an edit once.
 */
export function useLeaving(flush: (leaving: Leaving) => void): void {
  const latest = useRef(flush)
  latest.current = flush
  useEffect(() => {
    const hidden = () => document.visibilityState === 'hidden' && latest.current('hidden')
    const gone = () => latest.current('hidden')
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', gone)
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('pagehide', gone)
      latest.current('unmount')
    }
  }, [])
}
