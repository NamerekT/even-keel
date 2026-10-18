import { describe, expect, it } from 'vitest'
import type { SecretView } from '../../../src/state.js'
import { secretGroups } from './secretsRows.js'

const row = (name: string, readers: Partial<SecretView['readers']>): SecretView => ({
  name,
  secret: true,
  places: ['env'],
  readers: { tally: false, page: false, ...readers },
  set: true,
  value: null,
  outer: false,
  sessions: null,
  required: false,
})

describe('secretGroups', () => {
  it('puts a variable under its first reader: Tally, the page', () => {
    const groups = secretGroups([row('TALLY_DB_HOST', { tally: true }), row('TALLY_DB_PORT', { tally: true }), row('EVEN_KEEL_TOKEN', { page: true })])
    expect(groups.map(({ group, variables }) => [group, variables.map((each) => each.name)])).toEqual([
      ['tally', ['TALLY_DB_HOST', 'TALLY_DB_PORT']],
      ['page', ['EVEN_KEEL_TOKEN']],
    ])
  })
})
