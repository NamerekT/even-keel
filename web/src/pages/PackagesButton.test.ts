import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { PackageCell, PackagesView, PackageView } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { PackagesButton } from './PackagesButton.js'

const pkg = (name: string): PackageView => ({
  name,
  kind: name.includes('@') ? 'plugin' : 'mcp',
  installed: true,
  version: '1.0.0',
  latest: null,
  fetched: null,
  installing: false,
  error: null,
  note: null,
  default: false,
  settings: {},
  servers: [],
  extras: false,
  removed: false,
  builtIn: false,
})
const cell = (enabled: boolean, problems: PackageCell['problems'] = []): PackageCell => ({ choice: null, enabled, own: {}, problems })

const view = (cells: Record<string, PackageCell>): PackagesView => ({
  gateway: null,
  packages: [pkg('tasks@even-keel'), pkg('agent-bridge@even-keel'), pkg('forgejo'), pkg('db')],
  projects: { ABC: { cells, problems: [], blocked: false, tracker: null } },
  keys: [],
  available: [],
  marketplace: { name: 'even-keel', dir: 'C:\\even-keel', known: true },
  imports: {},
  skills: { package: 'my-skills@even-keel-skills', list: [] },
})

const render = (packages: PackagesView) =>
  renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/p/ABC#settings'] }, createElement(PackagesButton, { project: 'ABC', packages })))

describe('PackagesButton', () => {
  it('names the enabled packages without their marketplace and opens the packages over the open settings', () => {
    const html = render(view({ 'tasks@even-keel': cell(true), 'agent-bridge@even-keel': cell(true), forgejo: cell(false) }))
    expect(html).toContain('>agent-bridge, tasks<')
    expect(html).toContain('href="/p/ABC?pkg=1#settings"')
    expect(html).not.toContain('packages-button__link--warn')
  })

  it('says none is on', () => {
    expect(render(view({ forgejo: cell(false) }))).toContain(`>${t.packages.openNone}<`)
  })

  it('turns amber with the first problem and the count of the rest', () => {
    const html = render(
      view({
        forgejo: cell(true, [{ kind: 'noKey', variables: ['FORGEJO_TOKEN'] }]),
        db: cell(true, [{ kind: 'noResponse', servers: ['db'] }]),
        'tasks@even-keel': cell(true, [{ kind: 'probing' }]),
      }),
    )
    expect(html).toContain('packages-button__link--warn')
    expect(html).toMatch(/packages-button__line">forgejo: /)
    expect(html).toContain(`>${t.packages.more(1)}<`)
  })
})
