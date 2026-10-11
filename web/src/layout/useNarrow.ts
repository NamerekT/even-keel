import { useSyncExternalStore } from 'react'

const NARROW = '(max-width: 760px)'

function subscribe(onChange: () => void) {
  const query = window.matchMedia(NARROW)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** The width at which a side panel takes the whole window instead of a column. */
export function isNarrow(): boolean {
  return window.matchMedia(NARROW).matches
}

export function useNarrow() {
  return useSyncExternalStore(subscribe, isNarrow)
}
