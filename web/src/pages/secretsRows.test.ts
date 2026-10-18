import { describe, expect, it } from 'vitest'
import type { CiView } from '../../../src/ci/model.js'
import type { SecretView } from '../../../src/state.js'
import { readerLinks, secretGroups } from './secretsRows.js'

const row = (name: string, readers: Partial<SecretView['readers']>): SecretView => ({
  name,
  secret: true,
  places: ['env'],
  readers: { ci: [], tally: false, page: false, ...readers },
  set: true,
  value: null,
  outer: false,
  sessions: null,
  required: false,
})

const ci = (kind: 'forgejo' | 'github', health: CiView['health']) => ({ kind, health, error: null, checkedAt: '2026-10-18T10:00:00Z' }) as CiView

describe('secretGroups', () => {
  it('puts a variable under its first reader: the CI, Tally, the page', () => {
    const groups = secretGroups([row('FORGEJO_TOKEN', { ci: ['forgejo'] }), row('TALLY_DB_HOST', { tally: true }), row('TALLY_DB_PORT', { tally: true }), row('EVEN_KEEL_TOKEN', { page: true })])
    expect(groups.map(({ group, variables }) => [group, variables.map((each) => each.name)])).toEqual([
      ['ci', ['FORGEJO_TOKEN']],
      ['tally', ['TALLY_DB_HOST', 'TALLY_DB_PORT']],
      ['page', ['EVEN_KEEL_TOKEN']],
    ])
  })
})

describe('readerLinks', () => {
  it('tells whether every CI of the kind answers', () => {
    expect(readerLinks(row('FORGEJO_TOKEN', { ci: ['forgejo'] }), { ABC: [ci('forgejo', 'ok')], XYZ: [ci('forgejo', 'error')] })).toEqual([{ who: { ci: 'forgejo' }, state: 'down', error: null }])
    expect(readerLinks(row('FORGEJO_TOKEN', { ci: ['forgejo'] }), { ABC: [ci('forgejo', 'ok')] })).toEqual([{ who: { ci: 'forgejo' }, state: 'live', error: null }])
  })

  it('says nothing of a reader the page does not see', () => {
    expect(readerLinks(row('FORGEJO_TOKEN', { ci: ['forgejo'] }), {})).toEqual([])
  })
})
