import { describe, expect, it } from 'vitest'
import type { CiRun } from '../ci/model.js'
import type { FailedRun } from '../ci/report.js'
import { eventKey, outcomeOf } from './events.js'
import type { PullRequest, Remark, ReviewCheck } from './model.js'

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

function failed(id: number, status: CiRun['status'], commit = HEAD, log: string | null = null): FailedRun {
  return { kind: 'forgejo', run: run(id, status, commit), jobs: null, log }
}

const REQUEST: Remark = { key: 'review:501', kind: 'changes', author: 'jdoe', body: 'Rename the field', at: '2026-10-18T10:05:00Z', comments: [] }

function check(change: Partial<ReviewCheck> = {}): ReviewCheck {
  return { state: { state: 'open', mergeable: true, head: HEAD }, remarks: [], failed: [], ...change }
}

describe('outcomeOf', () => {
  it('finds nothing in a quiet open pull request', () => {
    expect(outcomeOf(PULL, check())).toEqual({ kind: 'none' })
  })

  it('tells a merge from a close without one', () => {
    expect(outcomeOf(PULL, check({ state: { state: 'merged', mergeable: null, head: HEAD } }))).toEqual({ kind: 'merged' })
    expect(outcomeOf(PULL, check({ state: { state: 'closed', mergeable: null, head: HEAD } }))).toEqual({ kind: 'closed', remarks: [] })
  })

  it('takes a review asking for changes once', () => {
    const found = outcomeOf(PULL, check({ remarks: [REQUEST] }))
    expect(found).toEqual({ kind: 'feedback', items: [{ kind: 'remark', remark: REQUEST }] })
    expect(outcomeOf({ ...PULL, seen: ['review:501'] }, check({ remarks: [REQUEST] }))).toEqual({ kind: 'none' })
  })

  it('takes a comment of the conversation once, by its own key', () => {
    const talk: Remark = { key: 'comment:77', kind: 'comment', author: 'jdoe', body: 'Make another file too', at: '2026-10-18T10:06:00Z', comments: [] }
    const found = outcomeOf({ ...PULL, seen: ['review:77'] }, check({ remarks: [talk] }))
    expect(found.kind === 'feedback' && found.items.map(eventKey)).toEqual(['comment:77'])
    expect(outcomeOf({ ...PULL, seen: ['comment:77'] }, check({ remarks: [talk] }))).toEqual({ kind: 'none' })
  })

  it('gives every remark of a pull request closed unmerged, the seen and the old ones included', () => {
    const closed = check({ state: { state: 'closed', mergeable: null, head: HEAD }, remarks: [REQUEST] })
    expect(outcomeOf({ ...PULL, seen: ['review:501'], pushedAt: '2026-10-18T11:00:00Z' }, closed)).toEqual({ kind: 'closed', remarks: [REQUEST] })
  })

  it('ignores a review submitted before the last push', () => {
    expect(outcomeOf({ ...PULL, pushedAt: '2026-10-18T11:00:00Z' }, check({ remarks: [REQUEST] }))).toEqual({ kind: 'none' })
  })

  it('takes failed runs of the head commit only, with their log tails', () => {
    const found = outcomeOf(PULL, check({ failed: [failed(1, 'failure', HEAD, 'TS2741'), failed(2, 'failure', 'old0000'), failed(3, 'success')] }))
    expect(found).toEqual({ kind: 'feedback', items: [{ kind: 'ci', run: run(1, 'failure'), log: 'TS2741' }] })
  })

  it('takes a conflict with main once per head commit', () => {
    const conflicting = check({ state: { state: 'open', mergeable: false, head: HEAD } })
    expect(outcomeOf(PULL, conflicting)).toEqual({ kind: 'feedback', items: [{ kind: 'conflict', head: HEAD }] })
    expect(outcomeOf({ ...PULL, seen: [`conflict:${HEAD}`] }, conflicting)).toEqual({ kind: 'none' })
    expect(outcomeOf(PULL, check({ state: { state: 'open', mergeable: null, head: HEAD } }))).toEqual({ kind: 'none' })
  })

  it('gathers every new event of one poll', () => {
    const found = outcomeOf(PULL, check({ state: { state: 'open', mergeable: false, head: HEAD }, remarks: [REQUEST], failed: [failed(1, 'failure')] }))
    expect(found.kind === 'feedback' && found.items.map(eventKey)).toEqual(['review:501', 'ci:1', `conflict:${HEAD}`])
  })
})
