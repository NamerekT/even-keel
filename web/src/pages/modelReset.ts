import { useEffect, useRef } from 'react'
import type { ModelAnswer } from './useModels.js'

/**
 * A provider's model field once its account changed in the form and the new account's catalogue answered (BTN-582):
 * cleared — back to the value it inherits — when the list is complete and lacks the model, else kept. A list of aliases
 * or no list at all says nothing about the models the account cannot run.
 */
export function modelAfterSwitch(model: string, answer: ModelAnswer): string {
  const named = model.trim()
  return answer !== null && answer.complete && named !== '' && !answer.models.includes(named) ? '' : model
}

/** A provider's row of a settings form: the account its field holds, the account it runs on, and its model field. */
export interface ModelRow {
  provider: string
  /** The form's own value of the account field; a change of it is a switch. */
  choice: string
  /** The account the row runs on, whose catalogue decides. */
  account: string
  model: string
}

/**
 * Clears the model fields `modelAfterSwitch` finds wrong for the accounts switched in the form. Only a switch made while
 * the form is open counts, never the values it opened with; a switch waits for its account's answer and is dropped when
 * the model is edited or the account switched again before it.
 */
export function useModelReset(rows: readonly ModelRow[], catalog: Record<string, ModelAnswer>, clear: (providers: string[]) => void) {
  const seen = useRef<Record<string, string> | null>(null)
  const waiting = useRef<Record<string, { account: string; model: string }>>({})

  useEffect(() => {
    const before = seen.current
    seen.current = Object.fromEntries(rows.map((row) => [row.provider, row.choice]))
    const cleared: string[] = []
    for (const row of rows) {
      const was = before?.[row.provider]
      if (was !== undefined && was !== row.choice) waiting.current[row.provider] = { account: row.account, model: row.model }
      const awaited = waiting.current[row.provider]
      if (awaited === undefined) continue
      if (awaited.account !== row.account || awaited.model !== row.model) {
        delete waiting.current[row.provider]
        continue
      }
      const answer = catalog[row.account]
      if (answer === undefined) continue
      delete waiting.current[row.provider]
      if (modelAfterSwitch(row.model, answer) !== row.model) cleared.push(row.provider)
    }
    if (cleared.length > 0) clear(cleared)
  })
}
