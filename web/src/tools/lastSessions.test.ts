import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ReceivedView, ToolsView } from '../../../src/tools/model.js'
import { t } from '../i18n/index.js'
import { LastSessions } from './LastSessions.js'

vi.mock('../live/context.js', () => ({ useLive: () => ({ state: null }) }))
vi.mock('../ui/ProjectLabel.js', () => ({ useProjectLabel: () => (id: string) => id }))

const received: ReceivedView = {
  sessionId: null,
  cwd: null,
  at: new Date(Date.now() - 42 * 60_000).toISOString(),
  version: '2.1.290',
  mode: 'auto',
  account: 'john.doe@example.com',
  skills: [
    { name: 'coding', source: 'project' },
    { name: 'tasks:task', source: 'plugin' },
    { name: 'tasks:split', source: 'plugin' },
  ],
  listingChars: 1_000,
  tools: ['Read'],
  mcp: [
    { name: 'plugin_tasks_tasks', tools: 96, failed: false },
    { name: 'forgejo', tools: 0, failed: true },
  ],
}

const render = (view: ReceivedView) =>
  renderToStaticMarkup(createElement(LastSessions, { views: [{ project: 'ABC', received: view } as ToolsView] }))

describe('the last session on /tools (BTN-1383)', () => {
  it('glues no facts with a dot', () => {
    expect(render(received)).not.toContain('·')
  })

  it('puts the age and the CLI in cells of their own and the mode in a tag', () => {
    const html = render(received)
    expect(html).toContain(`<span>${t.tools.cli('2.1.290')}</span>`)
    expect(html).toContain(`<span class="tag" title="${t.tools.modeTip}">auto</span>`)
    expect(render({ ...received, version: null, mode: null })).not.toContain('class="tag"')
  })

  it("counts a source's skills and a server's tools in a badge", () => {
    const html = render(received)
    expect(html).toContain(`${t.tools.source.plugin}<span class="count-badge">2</span>`)
    expect(html).toContain('plugin_tasks_tasks<span class="count-badge">96</span>')
  })

  it('marks a failed server with an icon and leaves the words to its tip', () => {
    const html = render(received)
    expect(html).toMatch(new RegExp(`title="${t.tools.mcpFailed}"><span class="tools__server"><svg[^]*?</svg>forgejo</span>`))
  })
})
