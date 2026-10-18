import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { trackerKeysOf } from '../config.js'
import { root } from '../locations.js'
import { ADAPTERS } from '../tracker/adapters.js'
import { changesOf, type RowChange } from './changes.js'
import { fileRows, withRows } from './file.js'
import { FULL } from './full.fixture.js'
import { DEFINITIONS, RESTART_FIELDS } from './registry.js'
import { checkRows, resolve, type SettingRow } from './resolve.js'

const fixtures = join(root, 'test', 'fixtures')
const samples = [
  ...readdirSync(fixtures)
    .filter((name) => name.startsWith('schema-v'))
    .map((name) => [name, JSON.parse(readFileSync(join(fixtures, name, 'even-keel.config.json'), 'utf8'))] as const),
  ['example', JSON.parse(readFileSync(join(root, 'even-keel.config.example.json'), 'utf8'))] as const,
  ['full', FULL] as const,
]
const keys = trackerKeysOf(ADAPTERS)
const trackers = Object.keys(ADAPTERS)
const ABC = 'id-abc'
const project = (fields: Record<string, unknown> = {}) => ({ id: ABC, key: 'ABC', repo: 'C:\\abc', ...fields })
const rowsOf = (raw: unknown) => {
  const { records, rows } = fileRows(raw, keys)
  return { records, rows: checkRows(rows, records, { trackers }) }
}
const set = ({ key, project, qualifier, value }: SettingRow): RowChange => ({ op: 'set', key, project, qualifier, value })
const unset = ({ key, project, qualifier }: SettingRow): RowChange => ({ op: 'unset', key, project, qualifier })

describe('the file as rows', () => {
  for (const [name, raw] of samples) {
    it(`writes ${name} back from its rows as it was`, () => {
      const { rows } = fileRows(raw, keys)
      const bare = withRows(raw, rows.map(unset))
      for (const level of [bare, ...(bare.projects as Record<string, unknown>[])]) {
        expect(Object.keys(level).filter((key) => DEFINITIONS.some((definition) => definition.key.split('.')[0] === key))).toEqual([])
      }
      expect(withRows(bare, rows.map(set))).toEqual(raw)
    })
  }

  it('gives a qualified key a row per entry, and a JSON null a row of its own', () => {
    const { rows } = rowsOf({ models: { claude: 'sonnet', codex: ' ' }, projects: [project({ chain: { terminal: null } })] })
    expect(rows.filter((row) => row.key === 'models' || row.key === 'chain.terminal')).toEqual([
      { key: 'models', project: null, qualifier: 'claude', value: 'sonnet' },
      { key: 'chain.terminal', project: ABC, qualifier: '', value: null },
    ])
  })

  it('reads a key only at the levels it takes', () => {
    const { rows } = fileRows({ prompt: 'Shared.', projects: [project({ parallel: 3, prompt: 'Own.' })] }, keys)
    expect(rows).toEqual([{ key: 'prompt', project: ABC, qualifier: '', value: 'Own.' }])
  })

  it('refuses a row at a level its key does not take', () => {
    expect(() => checkRows([{ key: 'prompt', project: null, qualifier: '', value: 'x' }], [], { trackers })).toThrow(/prompt/)
    expect(() => checkRows([{ key: 'models', project: null, qualifier: '', value: 'x' }], [], { trackers })).toThrow(/models/)
  })
})

describe('resolve', () => {
  it('takes the project row, then Even Keel, then the default, each entry of a qualified key on its own', () => {
    const { records, rows } = rowsOf({ models: { claude: 'sonnet' }, brief: false, projects: [project({ models: { codex: 'gpt-6.1-sol' } })] })
    const { shared, own, values } = resolve(records, rows)
    expect(shared).toMatchObject({ brief: false, models: { claude: 'sonnet' }, parallel: 1 })
    expect(own[ABC]).toEqual({ models: { codex: 'gpt-6.1-sol' } })
    expect(values[ABC]).toMatchObject({ brief: false, models: { claude: 'sonnet', codex: 'gpt-6.1-sol' }, 'ci.fixTask': false, parallel: 1 })
  })

  it('puts the run label over the project while run labels are on', () => {
    const { records, rows } = rowsOf({ modelLabels: true, projects: [project({ provider: 'claude' })] })
    const task = { project: ABC, id: 'ABC-1', labels: ['Bug', 'Codex | gpt-6.1-sol'] }
    expect(resolve(records, rows, task).values[ABC]).toMatchObject({ provider: 'codex', models: { claude: 'opus', codex: 'gpt-6.1-sol' } })
    const off = rowsOf({ projects: [project({ provider: 'claude' })] })
    expect(resolve(off.records, off.rows, task).values[ABC]).toMatchObject({ provider: 'claude', models: { claude: 'opus' } })
  })

  it('warns of run labels that contradict each other and keeps the project values', () => {
    const { records, rows } = rowsOf({ modelLabels: true, projects: [project()] })
    const resolved = resolve(records, rows, { project: ABC, id: 'ABC-1', labels: ['Codex', 'Claude | haiku'] })
    expect(resolved.values[ABC]).toMatchObject({ provider: 'claude', models: { claude: 'opus' } })
    expect(resolved.warnings).toEqual(['settings: ABC-1 carries labels Codex, Claude | haiku that contradict each other; launching it as its project says'])
  })
})

describe('changes of a form', () => {
  it('sets a changed value, unsets one equal to what it inherits, and leaves the unchanged groups', () => {
    const values = [
      { group: 'brief', key: 'brief', qualifier: '', value: false, fallback: false },
      { group: 'chain.terminal', key: 'chain.terminal', qualifier: '', value: null, fallback: ['Done'] },
      { group: 'models', key: 'models', qualifier: 'codex', value: 'gpt-6.1-sol' },
      { group: 'models', key: 'models', qualifier: 'claude', value: undefined },
      { group: 'prompt', key: 'prompt', qualifier: '', value: 'Hi.' },
    ]
    expect(changesOf(ABC, values, (group) => group !== 'prompt')).toEqual([
      { op: 'set', key: 'chain.terminal', project: ABC, qualifier: '', value: null },
      { op: 'set', key: 'models', project: ABC, qualifier: 'codex', value: 'gpt-6.1-sol' },
      { op: 'unset', key: 'brief', project: ABC, qualifier: '' },
      { op: 'unset', key: 'models', project: ABC, qualifier: 'claude' },
    ])
  })

  it('writes the changes at their JSON paths and drops the objects an unset empties', () => {
    const raw = { stats: { compare: { days: 14 }, extra: 1 }, projects: [project({ brief: true, models: { claude: 'haiku' } })] }
    const next = withRows(raw, [
      { op: 'set', key: 'models', project: ABC, qualifier: 'codex', value: 'gpt-6.1-sol' },
      { op: 'unset', key: 'models', project: ABC, qualifier: 'claude' },
      { op: 'unset', key: 'brief', project: ABC, qualifier: '' },
      { op: 'unset', key: 'stats.compare.days', project: null, qualifier: '' },
      { op: 'set', key: 'chain.terminal', project: ABC, qualifier: '', value: null },
    ])
    expect(next).toEqual({ stats: { extra: 1 }, projects: [project({ models: { codex: 'gpt-6.1-sol' }, chain: { terminal: null } })] })
    expect(raw.projects[0]).toEqual(project({ brief: true, models: { claude: 'haiku' } }))
  })

  it('refuses a change for a project the file does not have', () => {
    expect(() => withRows({ projects: [] }, [{ op: 'unset', key: 'brief', project: ABC, qualifier: '' }])).toThrow(/id-abc/)
  })
})

describe('the registry', () => {
  it('waits for a restart on the same fields the config did before it', () => {
    expect(new Set(RESTART_FIELDS)).toEqual(new Set(['projects', 'slots', 'tracker', 'trackers', 'trackerProjects', 'context']))
  })

  it('has one definition per key, each at a level', () => {
    expect(new Set(DEFINITIONS.map((definition) => definition.key)).size).toBe(DEFINITIONS.length)
    expect(DEFINITIONS.filter((definition) => definition.scopes.length === 0)).toEqual([])
  })
})
