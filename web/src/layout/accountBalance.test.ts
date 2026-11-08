import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AccountEntry } from '../../../src/account/model.js'
import { t } from '../i18n/index.js'
import { fakeAccount, FAKE_LIMITS } from '../live/fakeAccounts.js'
import { formatUsd } from '../stats/format.js'
import { AccountGroups } from './accountRows.js'

vi.mock('./AddAccountDialog.js', () => ({ useOpenAdd: () => () => {} }))
vi.mock('../live/context.js', () => ({ useLive: () => ({ state: null, command: vi.fn() }) }))
vi.mock('../ui/ProjectLabel.js', () => ({ useProjectLabel: () => (id: string) => id }))
beforeAll(() => vi.stubGlobal('localStorage', { getItem: () => null }))

/** The `/accounts` page with only the OpenRouter account of the fake connections, changed by `change`. */
function render(change: Partial<AccountEntry>) {
  const view = fakeAccount('connections', false, FAKE_LIMITS)
  view.accounts = view.accounts.filter((entry) => entry.key === 'opencode-openrouter').map((entry) => ({ ...entry, ...change }))
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AccountGroups, { view, now: new Date(), send: async () => true,
    sending: false, spend: null, tokens: null, page: true, marketplace: null })))
}

/** A text as the static markup writes it. */
const escaped = (text: string) => text.replaceAll("'", '&#x27;')

describe("an OpenRouter account's balance (BTN-868)", () => {
  it('without a management key shows no balance and its key limit tip says where to add one', () => {
    const html = render({ managementKey: false })
    expect(html).not.toContain(`>${t.account.balance}<`)
    expect(html).toContain(escaped(t.account.balanceNeedsKey))
  })

  it('shows the balance its management key read, and the key limit tip no longer asks for the key', () => {
    const html = render({ managementKey: true, balance: { usd: 74.75, at: new Date().toISOString() } })
    expect(html).toContain(`>${t.account.balance}<`)
    expect(html).toContain(formatUsd(74.75))
    expect(html).not.toContain(escaped(t.account.balanceNeedsKey))
  })

  it('shows the balance without a limit set on the key', () => {
    const html = render({ managementKey: true, keyLimit: undefined, balance: { usd: 3, at: new Date().toISOString() } })
    expect(html).toContain(`>${t.account.balance}<`)
    expect(html).not.toContain(`>${t.account.keyLeft}<`)
  })

  it('says a refused management key in place of the balance', () => {
    const html = render({ managementKey: true, balance: { rejected: true, at: new Date().toISOString() } })
    expect(html).toContain(`>${t.account.balance}<`)
    expect(html).toContain(t.account.balanceRefused)
  })
})
