import type { CSSProperties } from 'react'

export function seriesStyle(slot: number | null): CSSProperties {
  return { '--series': slot === null ? 'var(--series-other)' : `var(--series-${slot})` } as CSSProperties
}
