import { useSyncExternalStore } from 'react'

const WIDE = '(min-width: 1200px)'

function subscribe(onChange: () => void) {
  const query = window.matchMedia(WIDE)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function isWide(): boolean {
  return window.matchMedia(WIDE).matches
}

/** The width from which the project page keeps the side column (`.project` in `project.css`). */
export function useWide() {
  return useSyncExternalStore(subscribe, isWide)
}
