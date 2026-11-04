import { createContext, useContext, type FormEvent } from 'react'
import type { Draft } from './settingsDraft.js'
import type { SetDraft } from './settingsStore.js'

export const TableDraft = createContext<{ draft: Draft; setDraft: SetDraft } | null>(null)
export const useTableDraft = () => useContext(TableDraft)

/** Tables validate before the form serializes values that may discard empty cells or duplicate keys. */
export function invalidPending(draft: Draft, keys: readonly string[]): string[] {
  return keys.filter((key) => draft.adding?.[key]?.valid === false)
}

export function validateTables(event: FormEvent<HTMLFormElement>, invalid: readonly string[] = []) {
  if (tablesValid(event.currentTarget) && invalid.length === 0) return
  event.preventDefault()
  event.stopPropagation()
}

export function tablesValid(root: HTMLElement): boolean {
  const invalid = root.querySelectorAll<HTMLElement>('[data-rows-invalid="true"]')
  invalid.forEach((table) => table.dispatchEvent(new Event('validate-rows')))
  return invalid.length === 0
}
