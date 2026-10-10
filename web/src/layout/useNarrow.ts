import { useSyncExternalStore } from 'react'

const NARROW = '(max-width: 760px)'

function subscribe(onChange: () => void) {
  const query = window.matchMedia(NARROW)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

export function useNarrow() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(NARROW).matches)
}
