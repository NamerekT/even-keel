// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { LiveProvider, useLive } from '../live/context.js'
import { createFakeSource } from '../live/fake.js'
import { AccountsPage } from '../pages/Accounts.js'
import { AccountBlock } from './AccountBlock.js'
import { MachineAccountsBlock } from './MachineAccounts.js'
import { MachineFilterProvider } from './MachineFilter.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
beforeAll(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} }))

let root: Root | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})

function Where() {
  const location = useLocation()
  return createElement('output', { id: 'where' }, `${location.pathname}${location.search}`)
}

function Accounts() {
  const { state } = useLive()
  return state === null ? null : createElement(AccountsPage, { state })
}

/** The header's accounts block (and `/accounts`) of a view of the fake hub with machines elsewhere: `machine` — its `?machine=`. */
async function header(machine: string | null, hub = false, path = '/'): Promise<HTMLElement> {
  const source = createFakeSource('?machines=many&delay=0')
  const now = new Date()
  const block = () => {
    const state = source.snapshot().state!
    return hub ? createElement(AccountBlock, { account: state.account, limits: state.limits, now }) : createElement(MachineAccountsBlock, { now })
  }
  const frame = (child: () => ReactElement | null) => createElement(LiveProvider, {
    source, children: createElement(MachineFilterProvider, { children: [createElement(Where, { key: 'where' }), createElement(child, { key: 'child' })] }),
  })
  const router = createMemoryRouter([{ path: '/', element: frame(block) }, { path: '/accounts', element: frame(Accounts) }],
    { initialEntries: [machine === null ? path : `${path}?machine=${machine}`] })
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root!.render(createElement(RouterProvider, { router })))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)))
  return host
}

/** Presses the header's block: the narrow drawer with "+ Add account" at the left and "All accounts →" at the right. */
async function press(host: HTMLElement): Promise<HTMLElement> {
  const toggle = host.querySelector<HTMLButtonElement>('.account-block__toggle')
  expect(toggle).not.toBeNull()
  expect(toggle!.getAttribute('aria-controls')).toBe('account-panel')
  await act(async () => toggle!.click())
  expect(toggle!.getAttribute('aria-expanded')).toBe('true')
  const panel = host.querySelector<HTMLElement>('aside#account-panel.account-drawer')
  expect(panel).not.toBeNull()
  const row = [...panel!.querySelector('.accounts__add')!.children].map((each) => each.textContent)
  expect(row).toEqual(['+ Add account', 'All accounts →'])
  // The narrow drawer has no columns of the page.
  expect(panel!.querySelector('.account-blocks--page')).toBeNull()
  return panel!
}

async function allAccounts(host: HTMLElement, panel: HTMLElement): Promise<string> {
  await act(async () => panel.querySelector<HTMLAnchorElement>('a.accounts__all')!.click())
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
  expect(host.querySelector('#account-panel')).toBeNull()
  return host.querySelector('#where')!.textContent!
}

describe('the header\'s "Accounts" (BTN-1669)', () => {
  it('opens the narrow drawer on the hub; "All accounts" leads to the page', async () => {
    const host = await header(null, true)
    const panel = await press(host)
    expect(panel.querySelector('.ui-machine-label, .machine-label')).toBeNull()
    expect(await allAccounts(host, panel)).toBe('/accounts')
  })

  it('opens the hub\'s narrow drawer in "All machines"', async () => {
    const host = await header(null)
    const panel = await press(host)
    expect(await allAccounts(host, panel)).toBe('/accounts')
  })

  it('opens the machine\'s narrow drawer in its view, its rows not signed in there with "Sign in"', async () => {
    const host = await header('machine-1')
    const panel = await press(host)
    expect(panel.querySelector('.drawer__title')!.textContent).toContain('Example laptop')
    const away = [...panel.querySelectorAll('.account-row--away')]
    const why = away.map((row) => row.querySelector('.account-role--away')?.textContent)
    expect(why).toContain('signed in on the hub, not here')
    expect(why).toContain('not signed in')
    for (const row of away) expect([...row.querySelectorAll('button')].map((button) => button.textContent)).toContain('Sign in')
    expect(await allAccounts(host, panel)).toBe('/accounts?machine=machine-1')
  })
})

describe('the page /accounts (BTN-1669)', () => {
  it('is a page with the full table, not a drawer', async () => {
    const host = await header(null, false, '/accounts')
    expect(host.querySelector('aside')).toBeNull()
    expect(host.querySelector('.page.accounts-page .page__title')?.textContent).toBe('Accounts')
    expect(host.querySelector('.account-blocks--page')).not.toBeNull()
  })

  it('shows a machine elsewhere\'s accounts with the machine in the filter', async () => {
    const host = await header('machine-1', false, '/accounts')
    expect(host.querySelector('aside')).toBeNull()
    expect(host.querySelector('.page.accounts-page .page__title')?.textContent).toContain('Example laptop')
    expect(host.querySelector('.account-blocks--page')).not.toBeNull()
  })
})
