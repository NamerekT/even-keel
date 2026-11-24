import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { t } from '../i18n/index.js'
import { fakeAccount, FAKE_LIMITS } from '../live/fakeAccounts.js'
import { AccountGroups, CompactLimit, MenuMeters } from './accountRows.js'
import { Limits } from './Limits.js'
import { extraLines } from './Overage.js'

vi.mock('./AddAccountDialog.js', () => ({ useOpenAdd: () => () => {} }))
vi.mock('../live/context.js', () => ({ useLive: () => ({ state: null, command: vi.fn() }) }))
vi.mock('../ui/ProjectLabel.js', () => ({ useProjectLabel: () => (id: string) => id }))
beforeAll(() => vi.stubGlobal('localStorage', { getItem: () => null }))

const now = new Date()

const groups = (mode: string) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AccountGroups, {
  view: fakeAccount(mode, false, FAKE_LIMITS), now, send: async () => true, sending: false, spend: null, tokens: null, page: true,
})))

/** The captions of a `TipFacts` in the markup, in order. */
const captions = (html: string) => [...html.matchAll(/tip-facts__caption">([^<]*)</g)].map((found) => found[1])

describe('the accounts glue no facts with a "·" (BTN-1379)', () => {
  it.each(['connections', 'overage', 'rows', 'model-weeks', 'vscode-chats', 'outdated'])('the page of %s shows none', (mode) => {
    expect(groups(mode)).not.toContain('·')
  })

  it("heads a connection group by its name and a count badge, the tokens' source behind a help mark", () => {
    const html = groups('connections')
    expect(html).toMatch(/account-access__title">[^<]+<span class="count-badge">\d+<\/span>/)
    const tokens = html.split('account-access__title').some((head) => head.slice(0, 600).includes('class="help"'))
    expect(tokens).toBe(fakeAccount('connections', false, FAKE_LIMITS).accounts.some((entry) => entry.agent === 'opencode' && entry.limits === null))
  })

  it("names a meter's window in the tip's head and its reset and source as captioned lines", () => {
    const html = groups('rows')
    expect(html).toContain(`<span class="tip__head">${t.limits.fiveHourTitle}</span>`)
    expect(captions(html)).toEqual(expect.arrayContaining([t.limits.facts.resets, t.limits.facts.source]))
  })

  it('draws the state of a chat holding the account as a lamp of its level', () => {
    expect(groups('vscode-chats')).toMatch(/work__state work__state--(busy|waiting|idle)/)
  })
})

describe("the compact limit's tip", () => {
  it('heads the tightest window and gives what is free, the reset and the source a line each', () => {
    const entry = fakeAccount('rows', false, FAKE_LIMITS).accounts.find((each) => each.key === 'codex')!
    const html = renderToStaticMarkup(createElement(CompactLimit, { entry, now }))
    expect(html).not.toContain('·')
    expect(html).toContain(t.account.tightest(t.limits.weekTitle))
    expect(captions(html)).toEqual([t.limits.facts.free, t.limits.facts.resets, t.limits.facts.source])
  })
})

describe("the row menu's notes", () => {
  it('writes the reading and the outdated note a line each', () => {
    const entry = { ...fakeAccount('rows', false, FAKE_LIMITS).accounts[0]!, limitsOutdated: true }
    const html = renderToStaticMarkup(createElement(MenuMeters, { entry, now }))
    expect(html).not.toContain('·')
    expect(html.split('account-row__meters-aside').length - 1).toBeGreaterThanOrEqual(2)
  })
})

describe('the meters of a list', () => {
  it('put the reset and the source on lines of their own in the title', () => {
    const html = renderToStaticMarkup(createElement(Limits, { limits: FAKE_LIMITS, now }))
    expect(html).not.toContain('·')
    expect(html).toContain(`${t.limits.fiveHourTitle}\n${t.limits.facts.resets}: `)
    expect(html).toContain(`\n${t.limits.facts.source}: ${t.limits.origins[FAKE_LIMITS.source]}`)
  })
})

describe("extra usage's tip", () => {
  it('gives the source, the reading, the count and what it leaves out a line each', () => {
    const lines = extraLines({ source: 'github-quota', enabled: true, count: 3, updatedAt: now.toISOString() }, now)
    expect(lines).toHaveLength(4)
    expect(lines[1]).toMatch(/^Read /)
    for (const line of lines) expect(line).not.toContain('·')
  })
})
