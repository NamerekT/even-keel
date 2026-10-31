import { useEffect, useState } from 'react'
import { useLive } from '../live/context.js'

/** The service's answer to `models/list` (`ModelList` of `src/agent/contract.ts`). */
export type ModelAnswer = { models: string[]; complete: boolean } | null

/**
 * The models of these account folders (by key) the model fields offer, asked as the panel opens and when an account
 * changes; the service keeps each list for minutes, so asking again is cheap. An account its agent names none for adds
 * nothing, and nothing waits on it or shows an error (BTN-336). A key is missing until its answer comes; its
 * completeness is what pattern previews and the model reset of `useModelReset` go by.
 */
export function useModelCatalog(accounts: readonly string[]): Record<string, ModelAnswer> {
  const { query } = useLive()
  const [found, setFound] = useState<Record<string, ModelAnswer>>({})
  const wanted = [...new Set(accounts.filter((account) => account !== ''))].sort()
  const key = wanted.join('\u0000')

  useEffect(() => {
    let live = true
    for (const account of wanted) {
      query<ModelAnswer>('models/list', { account }).then(
        (answer) => {
          if (live) setFound((previous) => ({ ...previous, [account]: answer }))
        },
        () => {},
      )
    }
    return () => {
      live = false
    }
  }, [key])

  return found
}

/** The models a field of this account offers. */
export const offersOf = (catalog: Record<string, ModelAnswer>, account: string): string[] => catalog[account]?.models ?? []
