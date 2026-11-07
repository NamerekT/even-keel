import { afterAll, beforeAll, describe, expect, it, type TestContext } from 'vitest'
import { ADAPTERS } from '../tracker/adapters.js'
import { labelKey } from '../tracker/labels.js'
import type { TaskSource } from '../tracker/source.js'
import { adapterOf, idPrefix, readStands, STANDS_VARIABLE, type Stand } from './stands.fixture.js'

// One contract over every live tracker (BTN-470, docs/trackers.md, "Contract tests on live trackers"): each stand runs the
// same cases against its adapter. A case the stand cannot run — an optional method the adapter lacks, no task created —
// is skipped with the reason, never passed empty. The tasks it creates are closed at the end: the contract deletes nothing.

const TIMEOUT = 60_000
const PROJECT = 'contract'
const LABEL = 'contract-check'
const stands = readStands()

describe('the stands', () => {
  it.runIf(stands.length === 0 && process.env.CI !== undefined)(`are given in ${STANDS_VARIABLE}`, () => {
    expect.fail(`${STANDS_VARIABLE} is empty: a night without stands checks nothing`)
  })

  const covered = new Set(stands.map((stand) => stand.tracker))
  const missing = Object.entries(ADAPTERS).filter(([name, adapter]) => adapter.own !== true && !covered.has(name))
  for (const [name] of missing) it.skip(`${name}: no stand`, () => {})
})

for (const stand of stands) describe(stand.name, () => contract(stand))

function contract(stand: Stand): void {
  const adapter = adapterOf(stand)
  const marker = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const title = `Contract check ${marker}`
  const created: string[] = []
  let source: TaskSource
  let id = ''

  /** The task the cases work on; skips the case when it was not created. */
  const task = (context: TestContext): string => {
    if (id === '') context.skip('no task was created')
    return id
  }
  const needs = (context: TestContext, has: boolean, what: string): void => {
    if (!has) context.skip(`the adapter has no ${what}`)
  }

  beforeAll(async () => {
    const setup = adapter.setup({ ...stand.values }, { [PROJECT]: stand.place })
    if (setup === undefined) throw new Error(`${stand.name}: its values set none of ${adapter.variables.join(', ')}`)
    source = await setup.connect(TIMEOUT)
  }, TIMEOUT)

  afterAll(async () => {
    if (source === undefined) return
    for (const each of created) await source.complete?.(each, stand.done).catch((error: unknown) => console.warn(`${stand.name}: ${each} stays open: ${String(error)}`))
    await source.close()
  }, TIMEOUT)

  it('signs in with the profile', async () => {
    const account = await adapter.account(stand.values, TIMEOUT)
    expect(account.login).not.toBe('')
  }, TIMEOUT)

  it('lists projects', async () => {
    expect((await adapter.projects(stand.values, '', TIMEOUT)).length).toBeGreaterThan(0)
  }, TIMEOUT)

  it('creates a task ready for the chain', async (context) => {
    needs(context, source.create !== undefined, 'create')
    const made = await source.create!({ project: PROJECT, title, description: `Created by the contract tests, ${marker}.`, priority: 'low', milestoneOf: null })
    created.push(made)
    expect(made).toMatch(new RegExp(`^${idPrefix(stand)}-\\d+$`))
    const [read] = await source.tasks([made])
    expect(read).toMatchObject({ id: made, title, parent: null, subtasks: 0 })
    expect(read!.status.category).toBe('ToDo')
    id = made
  }, TIMEOUT)

  it('reads the task among the chain tasks', async (context) => {
    const at = task(context)
    const { tasks, statuses } = await source.chainTasks(PROJECT, (status) => status.category !== 'Won' && status.category !== 'Lost')
    expect(tasks.map((each) => each.id)).toContain(at)
    expect(statuses.length).toBeGreaterThan(0)
  }, TIMEOUT)

  it('gives the brief of the task', async (context) => {
    const at = task(context)
    needs(context, source.brief !== undefined, 'brief')
    const brief = await source.brief!(at)
    expect(brief.title).toBe(title)
    expect(brief.description).toContain(marker)
  }, TIMEOUT)

  it('moves the task back to the backlog and out of it', async (context) => {
    const at = task(context)
    needs(context, source.unready !== undefined && source.ready !== undefined, 'ready and unready')
    expect((await source.unready!(at))?.category).toBe('UnStarted')
    expect((await source.tasks([at]))[0]!.status.category).toBe('UnStarted')
    expect((await source.ready!(at))?.category).toBe('ToDo')
  }, TIMEOUT)

  it('moves the task to a named status', async (context) => {
    const at = task(context)
    needs(context, source.moveTo !== undefined, 'moveTo')
    if (stand.active === undefined) context.skip('the stand names no active status')
    const moved = await source.moveTo!(at, stand.active!)
    expect(moved?.category).toBe('Active')
    expect((await source.tasks([at]))[0]!.status.name.toLowerCase()).toBe(stand.active!.toLowerCase())
  }, TIMEOUT)

  it('adds and removes a label', async (context) => {
    const at = task(context)
    needs(context, source.relabel !== undefined, 'relabel')
    expect((await source.relabel!(at, { add: [LABEL], remove: [] })).map(labelKey)).toContain(LABEL)
    expect((await source.tasks([at]))[0]!.labels.map(labelKey)).toContain(LABEL)
    expect((await source.relabel!(at, { add: [], remove: [LABEL] })).map(labelKey)).not.toContain(LABEL)
  }, TIMEOUT)

  it('posts comments and reads those after one', async (context) => {
    const at = task(context)
    needs(context, source.comment !== undefined && source.commentsAfter !== undefined, 'comment and commentsAfter')
    const first = await source.comment!(at, `First comment, ${marker}`)
    expect(await source.commentsAfter!(at, first)).toEqual([])
    const second = await source.comment!(at, `Reply, **${marker}**`)
    const after = await source.commentsAfter!(at, first)
    expect(after.map((comment) => comment.id)).toEqual([second])
    expect(after[0]!.body).toContain(marker)
  }, TIMEOUT)

  it('shows the task on its card', async (context) => {
    const at = task(context)
    needs(context, source.card !== undefined, 'card')
    const card = await source.card!(at)
    expect(card).toMatchObject({ id: at, title })
    expect(card.description).toContain(marker)
    if (source.comment !== undefined) expect(card.comments.length).toBeGreaterThanOrEqual(2)
  }, TIMEOUT)

  it('reads a blocks relation', async (context) => {
    if (stand.blocks === undefined) context.skip('the stand has no seeded pair')
    const [blocker, blocked] = stand.blocks!
    const [read] = await source.tasks([blocked])
    expect(read?.blockedBy).toContain(blocker)
    if (source.card === undefined) return
    const card = await source.card(blocker)
    expect(card.blocks.map((ref) => ref.id)).toContain(blocked)
  }, TIMEOUT)

  it('closes the task once', async (context) => {
    const at = task(context)
    needs(context, source.complete !== undefined, 'complete')
    expect(await source.complete!(at, stand.done)).toBe(true)
    created.splice(created.indexOf(at), 1)
    expect((await source.tasks([at]))[0]!.status.category).toBe('Won')
    expect(await source.complete!(at, stand.done)).toBe(false)
  }, TIMEOUT)
}
