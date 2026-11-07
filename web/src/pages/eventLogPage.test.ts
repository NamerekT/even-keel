import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { EventEntry } from '../../../src/event-log/model.js'
import { notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { EventLogPage } from './EventLogPage.js'

vi.mock('../live/context.js', () => ({ useLive: () => ({ state: null }) }))
beforeAll(() => vi.stubGlobal('localStorage', { getItem: () => null }))
afterAll(() => vi.unstubAllGlobals())

const entries: EventEntry[] = [
  { id: '1', at: '2026-11-05T10:00:00Z', level: 'info', notice: notice('eventLog.settings', {}), place: null },
  { id: '2', at: '2026-11-06T10:00:01Z', level: 'error', notice: notice('eventLog.chainHeld', { project: 'p-1' }), place: { view: 'project', project: 'p-1' } },
  { id: '3', at: '2026-11-06T10:00:20Z', level: 'info', notice: notice('eventLog.chainResumed', { project: 'p-1' }), place: { view: 'project', project: 'p-1' } },
]

function render(search = '', log = entries) {
  const state = { eventLog: log, projects: ['p-1', 'p-2'], projectLabels: { 'p-1': 'ABC', 'p-2': 'DEMO' }, ci: {} } as unknown as EvenKeelState
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [`/log${search}`] }, createElement(EventLogPage, { state })))
}

describe('the filtered log page', () => {
  it('drops empty days and keeps the time on the first visible entry of a minute', () => {
    const html = render('?level=error')
    expect(html.match(/<h2/g)).toHaveLength(1)
    expect(html.match(/<li /g)).toHaveLength(1)
    expect(html).toMatch(/event-log__time[^>]*>[^<]+</)
    expect(html).toContain('href="/p/p-1"')
  })

  it('shows a reset action for an empty result but no filters for a wholly empty log', () => {
    const emptyResult = render('?level=warning')
    expect(emptyResult).toContain(t.events.filters.empty)
    expect(emptyResult).toContain(t.events.filters.emptyAction)
    expect(emptyResult).toContain('role="combobox"')
    const emptyLog = render('?level=error', [])
    expect(emptyLog).toContain(t.events.emptyAction)
    expect(emptyLog).not.toContain('role="combobox"')
  })

  it('ignores a removed project and labels a selected existing project without entries', () => {
    expect(render('?project=gone').match(/<li /g)).toHaveLength(3)
    const emptyProject = render('?project=p-2')
    expect(emptyProject).toContain('select__value">DEMO</span>')
    expect(emptyProject).toContain(t.events.filters.empty)
    expect(emptyProject).not.toContain('>p-2<')
  })
})
