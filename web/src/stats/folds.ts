import { useState } from 'react'

export const FOLDS = ['rules', 'estimate', 'steps', 'tasks', 'stuck'] as const
export type Fold = (typeof FOLDS)[number]

const OPEN_KEY = 'even-keel.stats.open'

export function parseFolds(text: string | null): Fold[] {
  const saved = (text ?? '').split(',')
  return FOLDS.filter((fold) => saved.includes(fold)).sort((a, b) => saved.indexOf(a) - saved.indexOf(b))
}

export function foldText(open: Fold[]): string {
  return open.join(',')
}

export function withFold(open: Fold[], fold: Fold, on: boolean): Fold[] {
  if (open.includes(fold) === on) return open
  return on ? [...open, fold] : open.filter((each) => each !== fold)
}

/** The sections of the stats page below the overview start folded; the opened ones are remembered in the browser. */
export function useFolds(): { open: Fold[]; setFold: (fold: Fold, on: boolean) => void } {
  const [open, setOpen] = useState(readOpen)
  const setFold = (fold: Fold, on: boolean) => {
    const next = withFold(open, fold, on)
    if (next === open) return
    setOpen(next)
    try {
      localStorage.setItem(OPEN_KEY, foldText(next))
    } catch {}
  }
  return { open, setFold }
}

function readOpen(): Fold[] {
  try {
    return parseFolds(localStorage.getItem(OPEN_KEY))
  } catch {
    return []
  }
}
