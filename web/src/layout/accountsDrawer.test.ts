// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { MachineCard } from '../../../src/state.js'
import { LiveProvider } from '../live/context.js'
import { createFakeSource } from '../live/fake.js'
import { AccountBlock } from './AccountBlock.js'
import { MachineAccountsBlock } from './MachineAccounts.js'
import { MachineFilterProvider } from './MachineFilter.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
// The drawer's own content is the accounts page's; here only which machine's accounts the press opens matters.
vi.mock('../pages/Accounts.js', () => ({
  AccountsDrawer: ({ card }: { card: MachineCard | null }) => createElement('aside', { id: 'account-panel', 'data-machine': card?.id ?? 'hub' }),
}))
beforeAll(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} }))

let root: Root | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})

/** The header's accounts block of a view of the fake hub with machines elsewhere: `machine` — its `?machine=`. */
async function header(machine: string | null, hub = false): Promise<HTMLElement> {
  const source = createFakeSource('?machines=many&delay=0')
  const now = new Date()
  const block = () => {
    const state = source.snapshot().state!
    return hub ? createElement(AccountBlock, { account: state.account, limits: state.limits, now }) : createElement(MachineAccountsBlock, { now })
  }
  const page = createElement(LiveProvider, { source, children: createElement(MachineFilterProvider, { children: createElement(block) }) })
  const router = createMemoryRouter([{ path: '/', element: page }], { initialEntries: [machine === null ? '/' : `/?machine=${machine}`] })
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root!.render(createElement(RouterProvider, { router })))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)))
  return host
}

async function press(host: HTMLElement): Promise<string | null | undefined> {
  const toggle = host.querySelector<HTMLButtonElement>('.account-block__toggle')
  expect(toggle).not.toBeNull()
  expect(toggle!.getAttribute('aria-controls')).toBe('account-panel')
  await act(async () => toggle!.click())
  expect(toggle!.getAttribute('aria-expanded')).toBe('true')
  return host.querySelector('#account-panel')?.getAttribute('data-machine')
}

describe('the header\'s "Accounts" (BTN-1587)', () => {
  it('opens the hub\'s accounts drawer on the hub', async () => {
    const host = await header(null, true)
    expect(host.querySelector('.account-card')).not.toBeNull()
    expect(host.textContent).not.toContain('All accounts')
    expect(await press(host)).toBe('hub')
    expect(host.querySelector('.account-card')).toBeNull()
  })

  it('opens the hub\'s accounts drawer in "All machines", its pointing card without a link to the page', async () => {
    const host = await header(null)
    expect(host.querySelector('.machine-accounts__card')).not.toBeNull()
    expect(host.querySelector('a[href="/accounts"]')).toBeNull()
    expect(host.textContent).not.toContain('All accounts')
    expect(await press(host)).toBe('hub')
    expect(host.querySelector('.machine-accounts__card')).toBeNull()
  })

  it('opens the machine\'s own accounts drawer in a machine elsewhere\'s view', async () => {
    const host = await header('machine-1')
    expect(host.textContent).not.toContain('All accounts')
    expect(await press(host)).toBe('machine-1')
  })
})
