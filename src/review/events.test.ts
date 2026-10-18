import { describe, expect, it } from 'vitest'
import type { CiRun } from '../ci/model.js'
import { eventKey, outcomeOf } from './events.js'
import type { ChangeRequest, PullRequest, ReviewCheck } from './model.js'

const PULL: PullRequest = {
  task: 'ABC-7',
  remote: 'origin',
  number: 12,
  url: 'https://git.example.com/acme/app/pulls/12',
  branch: 'abc-7/task',
  at: '2026-10-18T10:00:00Z',
  pushedAt: '2026-10-18T10:00:00Z',
  markAt: '2026-10-18T09:59:00Z',
  seen: [],
}

const HEAD = 'a1b2c3d4'

function run(id: number, status: CiRun['status'], commit = HEAD): CiRun {
  return { id, number: id, title: 'Tests', workflow: 'test.yml', commit, status, createdAt: '2026-10-18T10:01:00Z', startedAt: null, stoppedAt: null, url: `https://ci/${id}` }
}

const REQUEST: ChangeRequest = { id: '501', author: 'jdoe', body: 'Rename the field', at: '2026-10-18T10:05:00Z', comments: [] }

function check(change: Partial<ReviewCheck> = {}): ReviewCheck {
  return { state: { state: 'open', mergeable: true, head: HEAD }, changes: [], failed: [], ...change }
}

describe('outcomeOf', () => {
  it('finds nothing in a quiet open pull request', () => {
    expect(outcomeOf(PULL, check())).toEqual({ kind: 'none' })
  })

  it('tells a merge from a close without one', () => {
    expect(outcomeOf(PULL, check({ state: { state: 'merged', mergeable: null, head: HEAD } }))).toEqual({ kind: 'merged' })
    expect(outcomeOf(PULL, check({ state: { state: 'closed', mergeable: null, head: HEAD } }))).toEqual({ kind: 'closed' })
  })

  it('takes a review asking for changes once', () => {
    const found = outcomeOf(PULL, check({ changes: [REQUEST] }))
    expect(found).toEqual({ kind: 'feedback', items: [{ kind: 'changes', request: REQUEST }] })
    expect(outcomeOf({ ...PULL, seen: ['review:501'] }, check({ changes: [REQUEST] }))).toEqual({ kind: 'none' })
  })

  it('ignores a review submitted before the last push', () => {
    expect(outcomeOf({ ...PULL, pushedAt: '2026-10-18T11:00:00Z' }, check({ changes: [REQUEST] }))).toEqual({ kind: 'none' })
  })

  it('takes failed runs of the head commit only', () => {
    const found = outcomeOf(PULL, check({ failed: [run(1, 'failure'), run(2, 'failure', 'old0000'), run(3, 'success')] }))
    expect(found).toEqual({ kind: 'feedback', items: [{ kind: 'ci', run: run(1, 'failure') }] })
  })

  it('takes a conflict with main once per head commit', () => {
    const conflicting = check({ state: { state: 'open', mergeable: false, head: HEAD } })
    expect(outcomeOf(PULL, conflicting)).toEqual({ kind: 'feedback', items: [{ kind: 'conflict', head: HEAD }] })
    expect(outcomeOf({ ...PULL, seen: [`conflict:${HEAD}`] }, conflicting)).toEqual({ kind: 'none' })
    expect(outcomeOf(PULL, check({ state: { state: 'open', mergeable: null, head: HEAD } }))).toEqual({ kind: 'none' })
  })

  it('gathers every new event of one poll', () => {
    const found = outcomeOf(PULL, check({ state: { state: 'open', mergeable: false, head: HEAD }, changes: [REQUEST], failed: [run(1, 'failure')] }))
    expect(found.kind === 'feedback' && found.items.map(eventKey)).toEqual(['review:501', 'ci:1', `conflict:${HEAD}`])
  })
})
