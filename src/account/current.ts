import { accountId, launchBlock, type AccountView } from './model.js'

/** The account folder as the chain judges a launch in it. */
export function currentAccount(view: AccountView, key = view.active) {
  const entry = view.accounts.find((each) => each.key === key)
  const loggedIn = entry?.status?.loggedIn === true
  const email = loggedIn ? entry?.status?.email ?? null : null
  return {
    id: loggedIn ? accountId(key, email) : null,
    ready: loggedIn && launchBlock(view, key) === undefined,
    label: entry?.name ?? email ?? key,
    provider: entry?.agent,
  }
}
