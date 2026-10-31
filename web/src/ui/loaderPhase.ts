import { useEffect, useState } from 'react'

/**
 * The loader's life, set by the page and not by the data: the entrance, the shortest stay, the wait while loading
 * goes on, the exit, and then the content. A fast answer still sees the whole entrance and exit, so the loader
 * never flashes for a frame.
 */
export type LoaderPhase = 'in' | 'stay' | 'wait' | 'out' | 'done'

/** The entrance eases out, the exit is a little quicker than it, as a thing leaving moves faster than one arriving. */
export const LOADER_MS = { in: 120, stay: 80, out: 100 } as const

/** The phase that follows and in how many milliseconds; `null` waits for loading to start or end. */
export function loaderStep(phase: LoaderPhase, busy: boolean): { next: LoaderPhase; after: number } | null {
  switch (phase) {
    case 'done':
      return busy ? { next: 'in', after: 0 } : null
    case 'in':
      return { next: 'stay', after: LOADER_MS.in }
    case 'stay':
      return { next: 'wait', after: LOADER_MS.stay }
    case 'wait':
      return busy ? null : { next: 'out', after: 0 }
    case 'out':
      return { next: 'done', after: LOADER_MS.out }
  }
}

/** The loader's phase for `busy`; nothing was loading at the first render — `done` at once, with no loader. */
export function useLoader(busy: boolean): LoaderPhase {
  const [phase, setPhase] = useState<LoaderPhase>(busy ? 'in' : 'done')
  const step = loaderStep(phase, busy)
  const next = step?.next ?? null
  const after = step?.after ?? 0

  useEffect(() => {
    if (next === null) return
    if (after === 0) {
      setPhase(next)
      return
    }
    const timer = setTimeout(() => setPhase(next), after)
    return () => clearTimeout(timer)
  }, [phase, next, after])

  return phase
}
