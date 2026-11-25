import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AccountEntry } from '../../../src/account/model.js'
import { t } from '../i18n/index.js'
import { RenewWhy } from './ChatRenewDialog.js'
import { ActiveTab } from './ChatsPanel.js'
import { barTip, blockOf } from './ChatChoiceForm.js'
import { Gone } from './ShareCard.js'

const NOW = new Date('2026-10-12T12:00:00Z')

const html = (element: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(element)

describe('the chats glue no facts with a dot (BTN-1377)', () => {
  it("puts the active chats' count into a badge of the tab", () => {
    const markup = html(createElement(ActiveTab, { count: 4 }))
    expect(markup).not.toContain('·')
    expect(markup).toContain(t.chats.active)
    expect(markup).toContain('<span class="count-badge">4</span>')
  })

  it('crosses out a file that is gone and says so in the tip', () => {
    const markup = html(createElement(Gone, { name: 'plan.md' }))
    expect(markup).not.toContain('·')
    expect(markup).toContain('share__gone-name')
    expect(markup).toContain(t.session.chat.share.goneTip)
  })

  it('says when the cache went cold, how much a reply rereads in the tip', () => {
    const since = '2026-10-12T11:55:00Z'
    const tokens = html(createElement(RenewWhy, { renewal: { kind: 'cold', since, tokens: 120_000 }, now: NOW }))
    expect(tokens).not.toContain('·')
    expect(tokens).toContain('renew-chat__info')
    expect(tokens).toContain(t.chats.renew.rereads('120k'))
    const bare = html(createElement(RenewWhy, { renewal: { kind: 'cold', since, tokens: 0 }, now: NOW }))
    expect(bare).not.toContain('·')
    expect(bare).toContain(t.chats.renew.rereadsAll)
  })

  it('names the spent window, its reset in the tip', () => {
    const spent = html(createElement(RenewWhy, { renewal: { kind: 'limit', span: 'fiveHour', resetsAt: '2026-10-12T14:00:00Z' }, now: NOW }))
    expect(spent).not.toContain('·')
    expect(spent).toContain(t.chats.renew.limit(t.limits.fiveHourTitle))
    expect(spent).toContain(t.limits.facts.resets)
    const bare = html(createElement(RenewWhy, { renewal: { kind: 'limit', span: null, resetsAt: null }, now: NOW }))
    expect(bare).toContain(t.chats.renew.limitBare)
    expect(bare).not.toContain('renew-chat__info')
  })

  it("draws a limit bar's tip as captioned rows", () => {
    const markup = html(createElement('span', null, barTip('fiveHour', 37, '2026-10-12T13:59:00Z', NOW)))
    expect(markup).not.toContain('·')
    expect(markup).toContain(`<span class="tip__head">${t.limits.fiveHourTitle}</span>`)
    expect(markup).toContain(t.limits.facts.used)
    expect(markup).toContain(t.limits.facts.resets)
  })

  it('names the reset of a spent account without a dot', () => {
    const entry = { needsLogin: false, limits: { fiveHour: { usedPercentage: 100, resetsAt: '2026-10-12T14:00:00Z' } } } as unknown as AccountEntry
    const why = blockOf(entry, NOW)
    expect(why).not.toBeNull()
    expect(why).not.toContain('·')
  })
})
