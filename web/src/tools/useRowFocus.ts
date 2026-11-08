import { useCallback } from 'react'
import { rowId } from './PackagesParts.js'

/** Opens a package's row and brings it into view once it is drawn: the way a problem leads to its package. */
export function useRowFocus(scope: string, open: (name: string) => void): (name: string) => void {
  return useCallback(
    (name: string) => {
      open(name)
      requestAnimationFrame(() => {
        const row = document.getElementById(rowId(scope, name))
        row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        row?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
      })
    },
    [scope, open],
  )
}
