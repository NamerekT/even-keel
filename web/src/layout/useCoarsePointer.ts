import { useSyncExternalStore } from 'react'

const COARSE = '(pointer: coarse)'

function subscribe(onChange: () => void) {
  const query = window.matchMedia(COARSE)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function isCoarsePointer(): boolean {
  return window.matchMedia(COARSE).matches
}

export function useCoarsePointer() {
  return useSyncExternalStore(subscribe, isCoarsePointer)
}
