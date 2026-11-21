import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, expect, it, vi } from 'vitest'
import { fakeAccount, FAKE_LIMITS } from '../live/fakeAccounts.js'
import { AccountProblem } from './accountProblems.js'

vi.mock('./AddAccountDialog.js', () => ({ useOpenAdd: () => () => {} }))
vi.mock('../live/context.js', () => ({ useLive: () => ({ state: null, command: vi.fn() }) }))
beforeAll(() => vi.stubGlobal('localStorage', { getItem: () => null }))

function problems(mode: string): string {
  const view = fakeAccount(mode, false, FAKE_LIMITS)
  return view.accounts.map((entry) => renderToStaticMarkup(createElement(AccountProblem, { entry, view, now: new Date(), send: async () => true, sending: false }))).join('')
}

it('shows the terminal command in the problem band under the account (EKR-73)', () => {
  const html = problems('copilot-out')
  expect(html).toContain('COPILOT_HOME=')
  expect(html).toContain('.copilot-accounts/copilot')
  expect(html).toContain('ui-command')
})

it('removes the sign-in problem after the account refresh reports a successful sign-in', () => {
  expect(problems('copilot')).not.toContain('COPILOT_HOME=')
})
