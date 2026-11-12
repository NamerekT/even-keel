import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { t } from '../i18n/index.js'
import { fakeAccount, FAKE_LIMITS } from '../live/fakeAccounts.js'
import { AccountGroups, MenuMeters } from './accountRows.js'

vi.mock('./AddAccountDialog.js', () => ({ useOpenAdd: () => () => {} }))
vi.mock('../live/context.js', () => ({ useLive: () => ({ state: null, command: vi.fn() }) }))
vi.mock('../ui/ProjectLabel.js', () => ({ useProjectLabel: () => (id: string) => id }))
beforeAll(() => vi.stubGlobal('localStorage', { getItem: () => null }))

const view = fakeAccount('model-weeks', false, FAKE_LIMITS)
const now = new Date()

/** The compact cell of each row, the one a narrow screen shows: from its opening to the row's end. */
function compacts(): string[] {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AccountGroups, { view, now, send: async () => true,
    sending: false, spend: null, tokens: null })))
  return html.split('<div class="account-compact">').slice(1).map((part) => part.slice(0, part.indexOf('</div>')))
}

describe('the narrow account row (BTN-1043)', () => {
  it('names the model beside the percent only for an account with a model week', () => {
    const cells = compacts()
    expect(cells).toHaveLength(view.accounts.length)
    const withWeek = view.accounts.filter((entry) => (entry.limits?.models?.weeks.length ?? 0) > 0).length
    expect(withWeek).toBeLessThan(view.accounts.length)
    expect(cells.filter((cell) => cell.includes('>Fable<'))).toHaveLength(withWeek)
  })

  it('keeps no tip on the percent: a tap opens only the row menu', () => {
    for (const cell of compacts()) {
      expect(cell).not.toContain('tipped')
      expect(cell).not.toContain('tabindex')
    }
  })
})

describe("the row menu's counters (BTN-1043)", () => {
  const render = (index: number) => renderToStaticMarkup(createElement(MenuMeters, { entry: view.accounts[index]!, now }))

  it("shows the plan's windows and the model's week by their full names, the reset and the reading's source", () => {
    const html = render(2)
    expect(html).toContain(t.limits.fiveHour)
    expect(html).toContain(t.limits.modelWeek('Fable'))
    expect(html).toContain('41%')
    expect(html).toContain(t.limits.updated(t.limits.sources[view.accounts[2]!.limits!.source], ''))
  })

  it('is no control: nothing in it takes focus or opens a tip', () => {
    const html = render(0)
    expect(html).not.toContain('tipped')
    expect(html).not.toContain('tabindex')
    expect(html).not.toContain('<button')
  })

  it('is absent for an account without a reading', () => {
    expect(renderToStaticMarkup(createElement(MenuMeters, { entry: { ...view.accounts[0]!, limits: null }, now }))).toBe('')
  })
})
