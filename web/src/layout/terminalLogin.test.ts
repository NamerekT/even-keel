import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, expect, it, vi } from 'vitest'
import { fakeAccount, FAKE_LIMITS } from '../live/fakeAccounts.js'
import { AccountProblems } from './accountRows.js'

vi.mock('./AddAccountDialog.js', () => ({ useOpenAdd: () => () => {} }))
vi.mock('../live/context.js', () => ({ useLive: () => ({ state: null, command: vi.fn() }) }))
beforeAll(() => vi.stubGlobal('localStorage', { getItem: () => null }))

it('shows the terminal command in the actionable sign-in problem band (EKR-73)', () => {
  const view = fakeAccount('copilot-out', false, FAKE_LIMITS)
  const html = renderToStaticMarkup(createElement(AccountProblems, { view, now: new Date(), send: async () => true, sending: false }))
  expect(html).toContain('COPILOT_HOME=')
  expect(html).toContain('.copilot-accounts/copilot')
  expect(html).toContain('ui-command')
})

it('removes the sign-in problem after the account refresh reports a successful sign-in', () => {
  const view = fakeAccount('copilot', false, FAKE_LIMITS)
  const html = renderToStaticMarkup(createElement(AccountProblems, { view, now: new Date(), send: async () => true, sending: false }))
  expect(html).not.toContain('COPILOT_HOME=')
})
