import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { fakeAccount, FAKE_LIMITS } from '../live/fakeAccounts.js'
import { AccountTag } from './AccountTag.js'

const { live } = vi.hoisted(() => ({ live: { state: undefined as unknown } }))
vi.mock('../live/context.js', () => ({ useLive: () => live }))

describe('AccountTag', () => {
  it('renders the name and tooltip of the session agent with a shared e-mail', () => {
    const account = fakeAccount('codex', false, FAKE_LIMITS)
    account.accounts.find((entry) => entry.key === 'global')!.name = 'Claude account'
    account.accounts.find((entry) => entry.key === 'codex')!.name = 'OpenAI account'
    live.state = { account }
    const render = (agent?: string) => renderToStaticMarkup(createElement(AccountTag, { account: 'john.doe@example.com', agent }))

    expect(render('codex')).toContain('>OpenAI account</span>')
    expect(render('codex')).toContain('codex · john.doe@example.com')
    expect(render('claude')).toContain('>Claude account</span>')
    expect(render()).toContain('>Claude account</span>')
    expect(render('copilot')).toContain('--series:var(--series-other)')
    expect(render('copilot')).toContain('>john.doe</span>')
  })

  it('keeps missing and not yet loaded account data renderable', () => {
    live.state = undefined
    expect(renderToStaticMarkup(createElement(AccountTag, { account: null, agent: 'codex' }))).toBe('')
    expect(renderToStaticMarkup(createElement(AccountTag, { account: undefined }))).toBe('')
    expect(renderToStaticMarkup(createElement(AccountTag, { account: 'john.doe@example.com', agent: 'codex' }))).toContain('>john.doe</span>')
  })
})
