import type { CSSProperties } from 'react'

export function seriesStyle(slot: number | null): CSSProperties {
  return { '--series': slot === null ? 'var(--series-other)' : `var(--series-${slot})` } as CSSProperties
}

/** Shades for a breakdown that is not by project; `--tone-1` is the biggest share. */
export const TONES = 6

export function toneStyle(slot: number | null): CSSProperties {
  return { '--series': slot === null ? 'var(--series-other)' : `var(--tone-${slot})` } as CSSProperties
}
