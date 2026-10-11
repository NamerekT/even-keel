import type { AccountView } from '../../src/account/model.js'

const SERIES = 8

/** The series colour (1–8) of the account with this e-mail: by the order of the folder keys, so it is the same on every page. */
export function accountSlot(view: AccountView | undefined, email: string): number | null {
  if (view === undefined) return null
  const owner = view.accounts.find((entry) => entry.status?.email === email)
  if (owner === undefined) return null
  const keys = view.accounts.map((entry) => entry.key).sort()
  return (keys.indexOf(owner.key) % SERIES) + 1
}

export function folderEmail(view: AccountView | undefined, key: string): string {
  return view?.accounts.find((entry) => entry.key === key)?.status?.email ?? key
}
