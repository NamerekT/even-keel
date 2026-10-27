import { accountId, launchBlock, type AccountView } from './model.js'

/** The account folder as the chain judges a launch in it. */
export function currentAccount(view: AccountView, key = view.active) {
  const entry = view.accounts.find((each) => each.key === key)
  const email = entry?.status?.loggedIn === true ? entry.status.email : null
  return {
    id: accountId(key, email),
    ready: email !== null && launchBlock(view, key) === undefined,
    label: entry?.name ?? email ?? key,
    provider: entry?.agent,
  }
}
