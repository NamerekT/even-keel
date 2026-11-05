import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it } from 'vitest'
import { fakeAccount, FAKE_LIMITS } from '../live/fakeAccounts.js'
import { setLanguage } from '../i18n/index.js'
import { AccountNotes } from './accountParts.js'

afterEach(() => setLanguage('en'))

it.each(['ru', 'en'] as const)('shows unknown sign-in without asking to log in (%s)', (language) => {
  setLanguage(language)
  const view = fakeAccount('copilot-unknown', false, FAKE_LIMITS)
  const entry = view.accounts.find((each) => each.key === 'copilot')!
  const html = renderToStaticMarkup(createElement(AccountNotes, { entry, view, now: new Date(), sending: false, send: async () => true }))
  expect(html).toContain(language === 'ru' ? 'Не удалось проверить вход' : 'Could not check sign-in')
  expect(html).not.toContain('command-block')
  expect(html).not.toContain(language === 'ru' ? 'Войти' : 'Sign in')
})

it.each(['copilot-out', 'copilot-out-cmd'])('names the command shell for %s', (mode) => {
  const view = fakeAccount(mode, false, FAKE_LIMITS)
  const entry = view.accounts.find((each) => each.key === 'copilot')!
  const html = renderToStaticMarkup(createElement(AccountNotes, { entry, view, now: new Date(), sending: false, send: async () => true }))
  expect(html).toContain(mode.endsWith('cmd') ? 'in cmd' : 'in sh')
})
