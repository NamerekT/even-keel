import { describe, expect, it } from 'vitest'
import type { StatusMoves } from '../chain/moves.js'
import { DEFAULT_RULES, type ChainRules } from '../chain/rules.js'
import type { TaskStatus } from './model.js'
import { StatusMover, type MovePlan } from './mover.js'

const TODO: TaskStatus = { name: 'Todo', category: 'ToDo' }
const PROGRESS: TaskStatus = { name: 'In Progress', category: 'Active' }
const REVIEW: TaskStatus = { name: 'In Review', category: 'Active' }
const DONE: TaskStatus = { name: 'Done', category: 'Won' }
const STATUSES = [TODO, PROGRESS, REVIEW, DONE]

interface Options {
  profile?: StatusMoves
  source?: StatusMoves
  rules?: ChainRules
  status?: TaskStatus
  moveTo?: (status: string) => Promise<TaskStatus | null>
  plan?: MovePlan | undefined
}

function mover(options: Options) {
  let status = options.status ?? TODO
  const moved: string[] = []
  const lines: string[] = []
  const plan: MovePlan = { reader: 'ABC', rules: options.rules ?? DEFAULT_RULES, ...(options.profile && { profile: options.profile }), ...(options.source && { source: options.source }) }
  const statusMover = new StatusMover({
    plan: () => ('plan' in options ? options.plan : plan),
    current: async () => status,
    statuses: async () => STATUSES,
    moveTo: async (_reader, _task, name) => {
      moved.push(name)
      const found = options.moveTo === undefined ? (STATUSES.find((each) => each.name === name) ?? null) : await options.moveTo(name)
      if (found !== null) status = found
      return found
    },
    log: (line) => lines.push(line),
  })
  return { statusMover, moved, lines }
}

describe('StatusMover', () => {
  it('moves a ready task on its start and a started one on its pull request, by the profile', async () => {
    const { statusMover, moved } = mover({ profile: { start: 'In Progress', review: 'In Review' } })
    await statusMover.move('ABC', 'ABC-1', 'start')
    await statusMover.move('ABC', 'ABC-1', 'review')
    expect(moved).toEqual(['In Progress', 'In Review'])
    expect(statusMover.failures('ABC')).toEqual([])
  })

  it('does not move a task on a restart once it is past ready, nor one set to stay, nor without a choice', async () => {
    const { statusMover, moved } = mover({ profile: { start: 'In Progress', review: 'In Review' }, source: { review: null }, status: REVIEW })
    await statusMover.move('ABC', 'ABC-1', 'start')
    await statusMover.move('ABC', 'ABC-1', 'review')
    expect(moved).toEqual([])
    const none = mover({})
    await none.statusMover.move('ABC', 'ABC-1', 'start')
    expect(none.moved).toEqual([])
  })

  it('leaves a source with no plan alone', async () => {
    const { statusMover, moved } = mover({ profile: { start: 'In Progress' }, plan: undefined })
    await statusMover.move('ABC', 'ABC-1', 'start')
    expect(moved).toEqual([])
  })

  it('says a status out of the chain and does not move the task there', async () => {
    const { statusMover, moved } = mover({ source: { start: 'In Progress' }, rules: { ...DEFAULT_RULES, active: ['Todo'] } })
    await statusMover.move('ABC', 'ABC-1', 'start')
    expect(moved).toEqual([])
    expect(statusMover.failures('ABC')).toEqual([{ code: 'statusMove.outside', params: { task: 'ABC-1', status: 'In Progress', setting: 'start', level: 'source' } }])
  })

  it('keeps the tracker refusal for the page, without throwing, until a later move of the task goes through', async () => {
    let refuse = true
    const { statusMover, lines } = mover({
      profile: { start: 'In Progress', review: 'In Review' },
      moveTo: async (name) => {
        if (refuse) throw new Error('jira: HTTP 400: no transition')
        return STATUSES.find((each) => each.name === name) ?? null
      },
    })
    await statusMover.move('ABC', 'ABC-1', 'start')
    expect(statusMover.failures('ABC')).toEqual([
      { code: 'statusMove.refused', params: { task: 'ABC-1', status: 'In Progress', setting: 'start', level: 'profile' }, detail: 'jira: HTTP 400: no transition' },
    ])
    expect(lines.at(-1)).toContain('ABC-1')
    refuse = false
    await statusMover.move('ABC', 'ABC-1', 'review')
    expect(statusMover.failures('ABC')).toEqual([])
  })

  it('calls a status the tracker does not have a refusal too', async () => {
    const { statusMover } = mover({ profile: { start: 'Doing' }, moveTo: async () => null })
    await statusMover.move('ABC', 'ABC-1', 'start')
    expect(statusMover.failures('ABC')).toEqual([
      { code: 'statusMove.refused', params: { task: 'ABC-1', status: 'Doing', setting: 'start', level: 'profile' }, detail: 'no status "Doing" to move to from "Todo"' },
    ])
  })
})
