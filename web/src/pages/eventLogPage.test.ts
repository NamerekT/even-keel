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
    const emptyResult = render('?category=questions')
    expect(emptyResult).toContain(t.events.filters.empty)
    expect(emptyResult).toContain(t.events.filters.emptyAction)
    expect(emptyResult).toContain('role="combobox"')
    const emptyLog = render('?level=error', [])
    expect(emptyLog).toContain(t.events.emptyAction)
    expect(emptyLog).not.toContain('role="combobox"')
  })

  it('keeps the reset button in place, disabled until a filter is chosen', () => {
    const reset = new RegExp(`<button type="button"[^>]*event-log__reset[^>]*>${t.events.filters.reset}<`)
    expect(render()).toMatch(reset)
    expect(render().match(reset)![0]).toContain('disabled')
    expect(render('?category=chain').match(reset)![0]).not.toContain('disabled')
  })

  it('offers levels as a threshold and reads an old info level as all', () => {
    expect(render('?level=warning').match(/<li /g)).toHaveLength(1)
    expect(render('?level=info').match(/<li /g)).toHaveLength(3)
    expect(render('?level=info').match(/<button[^>]*event-log__reset[^>]*>/)![0]).toContain('disabled')
  })

  it('puts the subject in its own column, a task and a project both as links', () => {
    const html = render('', [
      ...entries,
      { id: '4', at: '2026-11-06T10:01:00Z', level: 'info', notice: notice('eventLog.launch', { task: 'ABC-7' }), place: { view: 'task', project: 'p-1', task: 'ABC-7' } },
    ])
    expect(html).toMatch(/<a [^>]*href="\/p\/p-1\?task=ABC-7"[^>]*>ABC-7<\/a>/)
    expect(html).toMatch(/event-log__subject[^>]*><a [^>]*href="\/p\/p-1"[^>]*>ABC<\/a>/)
    expect(html.match(/class="event-log__subject"/g)).toHaveLength(4)
    expect(html).not.toContain('ABC: ')
  })

  it('ignores a removed project and labels a selected existing project without entries', () => {
    expect(render('?project=gone').match(/<li /g)).toHaveLength(3)
    const emptyProject = render('?project=p-2')
    expect(emptyProject).toContain('select__value">DEMO</span>')
    expect(emptyProject).toContain(t.events.filters.empty)
    expect(emptyProject).not.toContain('>p-2<')
  })
})
