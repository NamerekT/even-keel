import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { t } from '../i18n/index.js'
import { fakeAccount, FAKE_LIMITS } from '../live/fakeAccounts.js'
import { fakePackages } from '../live/fakePackages.js'
import type { EvenKeelState } from '../../../src/state.js'
import { PackageCatalog } from '../tools/PackageCatalog.js'
import { AccountGroups } from './accountRows.js'

vi.mock('./AddAccountDialog.js', () => ({ useOpenAdd: () => () => {} }))
vi.mock('../live/context.js', () => ({ useLive: () => ({ state: null, command: vi.fn() }) }))
vi.mock('../ui/ProjectLabel.js', () => ({ useProjectLabel: () => (id: string) => id }))

const own = { name: 'even-keel', dir: 'C:\\Example\\Even Keel', known: false }
beforeAll(() => vi.stubGlobal('localStorage', { getItem: () => null }))

function render({ known = false, claude = true, page = true, missing = false, sending = false, login = false } = {}) {
  const view = fakeAccount('codex', false, FAKE_LIMITS)
  if (login) view.login = fakeAccount('login', false, FAKE_LIMITS).login
  if (!claude) view.accounts = view.accounts.filter((entry) => entry.agent !== 'claude')
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AccountGroups, { view, now: new Date(), send: async () => true,
    sending, spend: null, tokens: null, page, marketplace: missing ? null : { ...own, known } })))
}

describe('Claude account marketplace action', () => {
  it('offers registration before Add and includes the manual commands', () => {
    const html = render()
    expect(html).toContain('+ ' + t.account.marketplace)
    expect(html.indexOf(t.account.marketplace)).toBeLessThan(html.indexOf('+ ' + t.account.addHere))
    expect(html).toContain('claude plugin marketplace add')
    expect(html).toContain('claude plugin install huly@even-keel')
  })

  it('shows a quiet registered mark without a registration button', () => {
    const html = render({ known: true })
    expect(html).toContain('✓ ' + t.account.marketplace)
    expect(html).not.toContain('+ ' + t.account.marketplace)
  })

  it.each([{ claude: false }, { page: false }, { missing: true }])('hides the action for %j', (options) => {
    expect(render(options)).not.toContain('claude plugin marketplace add')
  })

  it('disables registration while a command is running', () => {
    expect(render({ sending: true })).toMatch(/disabled="">\+ /)
  })

  it('keeps registration available during account sign-in', () => {
    expect(render({ login: true })).toContain('+ ' + t.account.marketplace)
  })

  it('does not offer the marketplace command in the package catalog: its add dialog asks instead', () => {
    const state = { packages: fakePackages([], 'marketplace'), projects: [] } as unknown as EvenKeelState
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(PackageCatalog, { state })))
    expect(html).toContain(t.packages.addOpen)
    expect(html).not.toContain('claude plugin marketplace add')
    expect(html).not.toContain('packages__command')
  })
})
