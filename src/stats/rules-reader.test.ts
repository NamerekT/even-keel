import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { BASE } from './base-sql.js'
import { readCompare, readCompareSides, type RulesDb } from './rules-reader.js'

const db = new PGlite()
beforeAll(async () => {
  await db.exec(`
    set timezone = 'UTC';
    create table sample(session_id text, task text, at timestamptz, model text, cost float, agent_id text, message_id text, project text, entrypoint text);
    create table messages(message_id text, session_id text, agent_id text, at timestamptz, input int, cache_write_5m int, cache_write_1h int, cache_read int);
    create table spans(session_id text, agent_id text, from_at timestamptz, to_at timestamptz);
    create table tool_calls(session_id text, is_error bool, error_kind text);
    create table audit_sessions(task text, model text);
    create table task_estimates(task text, first_at timestamptz, done bool, cost float, active_min float, fact_ratio float);
    insert into sample values
      ('s1','ABC-1','2026-10-01','gpt-6.1-sol',4,'','m1','ABC','codex-exec'),
      ('s2','ABC-2','2026-10-02','claude-sonnet-5',2,'','m2','ABC','cli'),
      ('s3','ABC-3','2026-10-03','deepseek/deepseek-v3',1,'','m3','ABC','opencode'),
      ('s4','ABC-4','2026-10-04','gpt-6-terra',3,'','m4','ABC','codex-exec'),
      ('s5','ABC-5','2026-10-05','gpt-6.2-sol',5,'','m5','ABC','codex-exec');
    insert into messages select message_id,session_id,null,at,100,0,0,0 from sample;
    insert into tool_calls select session_id,false,null from sample;
    insert into audit_sessions select task,model from sample;
    insert into task_estimates select task,at,true,cost,10,0.5 from sample;
  `)
})
afterAll(() => db.close())
const reader = {
  base: async (sql: string, _filter: unknown, extra: unknown[]) => {
    const args = [[], [], 'UTC', 'all', null, [], [], ...extra]
    const source = sql.replace(BASE, 'with base as (select * from sample)')
    const params: unknown[] = []
    const positions = new Map<string, number>()
    const numbered = source.replace(/\$(\d+)/g, (_, n) => {
      if (!positions.has(n)) { params.push(args[Number(n) - 1]); positions.set(n, params.length) }
      return `$${positions.get(n)}`
    })
    return (await db.query(numbered, params)).rows
  },
} as RulesDb
const filter = { projects: null, scope: 'all' as const, account: null, tz: 'UTC' }
const period = { from: '2026-10-01T00:00:00Z', to: '2026-10-05T00:00:00Z' }

it('uses the same model families as the overview, including GPT tiers and DeepSeek', async () => {
  const result = await readCompareSides(reader, filter, { before: period, after: period })
  expect(result.before.families.map(f => f.family).sort()).toEqual(['deepseek', 'sol', 'sonnet', 'terra'])
  expect(result.after.tasks).toBe(4)
})

it('filters every metric independently on overlapping sides', async () => {
  const result = await readCompareSides(reader, { ...filter, beforeModels: ['sol'], afterModels: ['sonnet'] }, { before: period, after: period })
  expect(result.before).toMatchObject({ tasks: 1, sessions: 1, cost: 4, taskCost: 4, calls: 1, requests: 1, entryTokens: 100 })
  expect(result.after).toMatchObject({ tasks: 1, sessions: 1, cost: 2, taskCost: 2, calls: 1, requests: 1 })
  expect(result.before.families.map(f => f.family)).toEqual(['sol'])
  expect(result.after.families.map(f => f.family)).toEqual(['sonnet'])
})

it('supports several models and an empty selection', async () => {
  const result = await readCompareSides(reader, { ...filter, beforeModels: ['sol', 'terra'], afterModels: [] }, { before: period, after: period })
  expect(result.before).toMatchObject({ tasks: 2, sessions: 2, cost: 7, requests: 2 })
  expect(result.after).toMatchObject({ tasks: 0, sessions: 0, cost: 0, requests: 0 })
})

it('compares the shared page period with independent selections and half-open bounds', async () => {
  const result = await readCompare(reader, { ...filter, ...period, before: period.from, after: period.to, beforeModels: ['sol'], afterModels: ['sonnet'] }, { days: 7, minTasks: 1, minSessions: 1 })
  expect(result.before).toMatchObject({ ...period, tasks: 1, taskCost: 4 })
  expect(result.after).toMatchObject({ ...period, tasks: 1, taskCost: 2 })
  expect(result.modelShift).toBe(true)
})

it('suppresses version-mix warnings only for the same explicit family selection', async () => {
  const query = { ...filter, before: '2026-10-02T00:00:00Z', after: '2026-10-05T00:00:00Z', days: 1 }
  const settings = { days: 7, minTasks: 1, minSessions: 1 }
  expect((await readCompare(reader, query, settings)).modelShift).toBe(true)
  const selected = await readCompare(reader, { ...query, beforeModels: ['sol'], afterModels: ['sol'] }, settings)
  expect(selected.modelShift).toBe(false)
  expect(selected.before.taskCost).toBe(4)
  expect(selected.after.taskCost).toBe(5)
})
