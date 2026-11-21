import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AccountEntry, AccountView } from '../../../src/account/model.js'
import { fakeAccount, FAKE_LIMITS } from '../live/fakeAccounts.js'
import { accountAnchor, accountOfAnchor, AccountProblem, AccountProblems, problemTone } from './accountProblems.js'

vi.mock('./AddAccountDialog.js', () => ({ useOpenAdd: () => () => {} }))
vi.mock('../live/context.js', () => ({ useLive: () => ({ state: null, command: vi.fn() }) }))
beforeAll(() => vi.stubGlobal('localStorage', { getItem: () => null }))

const NOW = new Date()
const send = async () => true

function view(mode: string): AccountView {
  return fakeAccount(mode, false, FAKE_LIMITS)
}

function summary(account: AccountView, page = false): string {
  const band = createElement(AccountProblems, { view: account, now: NOW, page })
  return renderToStaticMarkup(page ? createElement(MemoryRouter, null, band) : band)
}

function patch(account: AccountView, key: string, change: Partial<AccountEntry>): AccountView {
  return { ...account, accounts: account.accounts.map((entry) => (entry.key === key ? { ...entry, ...change } : entry)) }
}

describe('problemTone', () => {
  it('calls a sign-in the account needs an error', () => {
    const account = view('expired')
    expect(problemTone(account.accounts.find((entry) => entry.needsLogin)!, account, NOW)).toBe('error')
  })

  it('calls a folder being removed and a sign-in ending within a day warnings', () => {
    const removing = view('removing')
    expect(problemTone(removing.accounts.find((entry) => entry.removing)!, removing, NOW)).toBe('warn')
    const ending = patch(view('expired'), 'global', { needsLogin: false, loginExpiresAt: new Date(NOW.getTime() + 3_600_000).toISOString() })
    expect(problemTone(ending.accounts.find((entry) => entry.key === 'global')!, ending, NOW)).toBe('warn')
  })

  it('warns of a sign-in a day before the early end of its window, not before; only needsLogin makes it an error', () => {
    const at = (hours: number) => {
      const account = patch(view('expired'), 'global', { needsLogin: false, loginExpiresAt: new Date(NOW.getTime() + hours * 3_600_000).toISOString() })
      return problemTone(account.accounts.find((entry) => entry.key === 'global')!, account, NOW)
    }
    expect(at(4 * 24 + 1)).toBeNull()
    expect(at(4 * 24 - 1)).toBe('warn')
    expect(at(2 * 24)).toBe('warn')
    expect(at(-1)).toBe('warn')
  })

  it('finds nothing in an account that works', () => {
    const account = view('cli')
    expect(account.accounts.map((entry) => problemTone(entry, account, NOW))).toEqual(account.accounts.map(() => null))
  })
})

describe('AccountProblems', () => {
  it('is absent while no account has a problem', () => {
    expect(summary(view('cli'))).toBe('')
  })

  it('names the one account with problems in a red band, without saying what is wrong', () => {
    const html = summary(view('expired'))
    expect(html).toContain('ui-band--error')
    expect(html).toMatch(/Account .*has problems/)
    expect(html).not.toContain('Sign in')
  })

  it('is yellow while every problem is a warning', () => {
    expect(summary(view('removing'))).toContain('ui-band--warn')
  })

  it('lists several accounts in one band, red when one of them has an error', () => {
    const account = patch(view('removing'), 'global', { needsLogin: true })
    const html = summary(account)
    expect(html.match(/ui-band--/g)).toHaveLength(1)
    expect(html).toContain('ui-band--error')
    expect(html).toContain('Accounts with problems')
  })

  it('names the agent only where an account of another agent has the same name', () => {
    const base = view('codex')
    const [first, second] = [base.accounts.find((entry) => entry.agent === 'claude')!, base.accounts.find((entry) => entry.agent === 'codex')!]
    const twins = patch(patch(base, first.key, { name: 'Work', needsLogin: true }), second.key, { name: 'Work', needsLogin: true })
    expect(summary(twins)).toContain('Codex › Work')
    const single = patch(base, first.key, { name: 'Work', needsLogin: true })
    expect(summary(single)).not.toContain('›')
  })

  it('links each name to its row: an anchor on the page, a button in the drawer', () => {
    const account = view('expired')
    const key = account.accounts.find((entry) => entry.needsLogin)!.key
    expect(summary(account, true)).toContain(`href="/#${accountAnchor(key)}"`)
    expect(summary(account)).toContain('<button')
  })
})

describe('accountOfAnchor', () => {
  it('reads the account back from the address, encoded or not', () => {
    expect(accountOfAnchor(`#${accountAnchor('jane.roe')}`)).toBe('jane.roe')
    expect(accountOfAnchor(`#${encodeURIComponent(accountAnchor('my key'))}`)).toBe('my key')
  })

  it('ignores any other hash', () => {
    expect(accountOfAnchor('')).toBeNull()
    expect(accountOfAnchor('#account-')).toBeNull()
    expect(accountOfAnchor('#models')).toBeNull()
    expect(accountOfAnchor('#%E0%A4%A')).toBeNull()
  })
})

describe('AccountProblem', () => {
  it('shows the problem with its fix and without the agent and connection path', () => {
    const account = view('expired')
    const entry = account.accounts.find((each) => each.needsLogin)!
    const html = renderToStaticMarkup(createElement(AccountProblem, { entry, view: account, now: NOW, send, sending: false }))
    expect(html).toContain('ui-band--error')
    expect(html).toContain('<button')
    expect(html).not.toContain('›')
  })

  it('is absent for an account that works', () => {
    const account = view('copilot')
    const entry = account.accounts.find((each) => each.key === 'copilot')!
    expect(renderToStaticMarkup(createElement(AccountProblem, { entry, view: account, now: NOW, send, sending: false }))).toBe('')
  })
})
