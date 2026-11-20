import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { NameValue, TrackerValue } from './ProjectSummary.js'
import { remotesOf } from './SettingsProfiles.js'

vi.mock('../live/context.js', () => ({ useLive: () => ({ state: null }) }))

describe('"What will be created" glues no facts (BTN-1382)', () => {
  it('puts the key in a tag beside the name', () => {
    const html = renderToStaticMarkup(createElement(NameValue, { name: 'Storefront', projectKey: 'ABC' }))
    expect(html).toBe('<dd class="project-summary__name">Storefront<span class="tag">ABC</span></dd>')
  })

  it('gives the key alone when it is the name too, a dash before either', () => {
    expect(renderToStaticMarkup(createElement(NameValue, { name: 'ABC', projectKey: 'ABC' }))).not.toContain('tag')
    expect(renderToStaticMarkup(createElement(NameValue, { name: '', projectKey: '' }))).toContain('project-summary__none')
  })

  it("draws the tracker by its icon before the place, by its name where there is no place", () => {
    const placed = renderToStaticMarkup(createElement(TrackerValue, { kind: 'github', tracker: 'GitHub', place: 'octo-org/web' }))
    expect(placed).toContain('<svg')
    expect(placed).toContain('octo-org/web')
    expect(placed).not.toMatch(/GitHub|·/)
    expect(renderToStaticMarkup(createElement(TrackerValue, { kind: 'builtin', tracker: 'Built-in tracker', place: '' }))).toContain('Built-in tracker')
    expect(renderToStaticMarkup(createElement(TrackerValue, { kind: null, tracker: 'GitHub', place: 'octo-org/web' }))).toContain('project-summary__none')
  })
})

describe('the remotes of a CI profile', () => {
  it('names each remote with its project in brackets, no dot', () => {
    expect(remotesOf([{ project: 'abc-id', remote: 'origin' }, { project: 'xyz-id', remote: 'github' }], (id) => id.slice(0, 3).toUpperCase())).toBe('origin (ABC), github (XYZ)')
  })
})
