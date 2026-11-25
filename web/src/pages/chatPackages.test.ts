import { describe, expect, it } from 'vitest'
import type { PackageCell, PackagesView, PackageView } from '../../../src/state.js'
import { chatPackageGroups, goneChoices, ownCount, withChoice } from './chatPackages.js'

const pkg = (name: string, over: Partial<PackageView> = {}): PackageView => ({
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
  unpinned: [],
  scripts: null,
  extras: false,
  removed: false,
  builtIn: false,
  ...over,
})

const cell = (choice: PackageCell['choice'], enabled: boolean): PackageCell => ({ choice, enabled, own: {}, problems: [] })

const view = (packages: PackageView[], cells: Record<string, PackageCell>): PackagesView => ({
  gateway: null,
  packages,
  projects: { 'p-1': { cells, problems: [], blocked: false, tracker: null } },
  keys: [],
  available: [],
  marketplace: null,
  imports: {},
})

const rows = (packagesView: PackagesView, own: Record<string, boolean>) => chatPackageGroups(packagesView, 'p-1', own).flatMap((group) => group.rows)

describe('chatPackageGroups', () => {
  const catalog = view(
    [pkg('lint@example', { default: true }), pkg('db'), pkg('review@example'), pkg('checkpoint@even-keel', { builtIn: true, default: true })],
    { 'lint@example': cell(null, true), db: cell('on', true), 'review@example': cell('off', false), 'checkpoint@even-keel': cell(null, true) },
  )

  it('says where each package of the set comes from: Even Keel, the project or the chat', () => {
    const found = rows(catalog, { 'review@example': true, db: false })
    expect(found.map(({ name, own, enabled, source }) => ({ name, own, enabled, source }))).toEqual([
      { name: 'checkpoint@even-keel', own: 'inherit', enabled: true, source: 'builtIn' },
      { name: 'lint@example', own: 'inherit', enabled: true, source: 'evenKeel' },
      { name: 'review@example', own: 'on', enabled: true, source: 'chat' },
      { name: 'db', own: 'off', enabled: false, source: 'chat' },
    ])
  })

  it('keeps what the level above gives next to the chat’s own value', () => {
    const found = rows(catalog, { db: false })
    expect(found.find((each) => each.name === 'db')?.above).toEqual({ enabled: true, source: 'project' })
  })

  it('never lets a chat turn the built-in package off', () => {
    expect(rows(catalog, { 'checkpoint@even-keel': false }).find((each) => each.name === 'checkpoint@even-keel')).toMatchObject({ own: 'inherit', enabled: true, source: 'builtIn' })
  })

  it('names a package by its short name', () => {
    expect(rows(catalog, {}).find((each) => each.name === 'lint@example')?.label).toBe('lint')
  })
})

describe('goneChoices', () => {
  it('lists the chat’s own values of packages out of the catalog, removed or not of the project', () => {
    const catalog = view([pkg('old@example', { removed: true }), pkg('lint@example'), pkg('other')], { 'old@example': cell(null, false), 'lint@example': cell(null, false) })
    expect(goneChoices(catalog, 'p-1', { 'old@example': true, 'lint@example': true, ghost: false, other: true })).toEqual([
      { name: 'ghost', on: false },
      { name: 'old@example', on: true },
      { name: 'other', on: true },
    ])
  })
})

describe('withChoice', () => {
  it('sets on and off and drops the name for "as above"', () => {
    expect(withChoice({}, 'db', 'on')).toEqual({ db: true })
    expect(withChoice({ db: true }, 'db', 'off')).toEqual({ db: false })
    expect(withChoice({ db: true, lint: false }, 'db', 'inherit')).toEqual({ lint: false })
  })
})

describe('ownCount', () => {
  it('counts the chat’s own values', () => {
    expect(ownCount({})).toBe(0)
    expect(ownCount({ db: true, lint: false })).toBe(2)
  })
})
