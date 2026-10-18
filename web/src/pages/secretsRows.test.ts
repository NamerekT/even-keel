import { describe, expect, it } from 'vitest'
import type { CiView } from '../../../src/ci/model.js'
import type { SecretView } from '../../../src/state.js'
import type { TrackerView } from '../../../src/tracker/health.js'
import { readerLinks, secretGroups } from './secretsRows.js'

const row = (name: string, readers: Partial<SecretView['readers']>): SecretView => ({
  name,
  secret: true,
  places: ['env'],
  readers: { trackers: [], ci: [], tally: false, page: false, ...readers },
  set: true,
  value: null,
  outer: false,
  sessions: null,
  required: false,
})

const huly: TrackerView = { name: 'huly', kind: 'huly', title: 'Huly', projects: ['ABC'], ready: true, health: { state: 'down', lastOkAt: null, error: 'huly: 401' }, readAt: {} }
const ci = (kind: 'forgejo' | 'github', health: CiView['health']) => ({ kind, health, error: null, checkedAt: '2026-10-18T10:00:00Z' }) as CiView

describe('secretGroups', () => {
  it('puts a variable under its first reader, a tracker before the CI', () => {
    const groups = secretGroups([
      row('HULY_PASSWORD', { trackers: ['huly'] }),
      row('GITHUB_TOKEN', { trackers: ['github'], ci: ['github'] }),
      row('FORGEJO_TOKEN', { ci: ['forgejo'] }),
      row('TALLY_DB_HOST', { tally: true }),
      row('EVEN_KEEL_TOKEN', { page: true }),
    ])
    expect(groups.map(({ group, variables }) => [group, variables.map((each) => each.name)])).toEqual([
      [{ kind: 'tracker', tracker: 'huly' }, ['HULY_PASSWORD']],
      [{ kind: 'tracker', tracker: 'github' }, ['GITHUB_TOKEN']],
      [{ kind: 'ci' }, ['FORGEJO_TOKEN']],
      [{ kind: 'tally' }, ['TALLY_DB_HOST']],
      [{ kind: 'page' }, ['EVEN_KEEL_TOKEN']],
    ])
  })
})

describe('readerLinks', () => {
  it('tells whether the tracker and every CI of the kind answer', () => {
    const links = readerLinks(row('GITHUB_TOKEN', { trackers: ['huly'], ci: ['github', 'forgejo'] }), [huly], { ABC: [ci('github', 'ok')], XYZ: [ci('github', 'error')] })
    expect(links).toEqual([
      { who: { tracker: 'Huly' }, state: 'down', error: 'huly: 401' },
      { who: { ci: 'github' }, state: 'down', error: null },
    ])
    expect(readerLinks(row('FORGEJO_TOKEN', { ci: ['forgejo'] }), [], { ABC: [ci('forgejo', 'ok')] })).toEqual([{ who: { ci: 'forgejo' }, state: 'live', error: null }])
  })

  it('says nothing of a reader the page does not see', () => {
    expect(readerLinks(row('LINEAR_TOKEN', { trackers: ['linear'] }), [huly], {})).toEqual([])
  })
})
