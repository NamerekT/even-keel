import { describe, expect, it } from 'vitest'
import type { CiRun, CiView, CurrentRun } from '../../src/ci/model.js'
import { ciLevel, worstCiLevel } from './ci.js'

const NOW = new Date('2026-10-12T12:00:00Z')

function run(overrides: Partial<CiRun> = {}): CiRun {
  return {
    id: 1,
    number: 1,
    title: 'run',
    workflow: 'test.yml',
    commit: 'abc',
    status: 'success',
    createdAt: '2026-10-12T11:59:00Z',
    startedAt: '2026-10-12T11:59:05Z',
    stoppedAt: '2026-10-12T11:59:50Z',
    url: 'https://ci.example.com/runs/1',
    ...overrides,
  }
}

const push = (...runs: CiRun[]): CurrentRun => ({ commit: 'abc', title: 'run', manual: false, tasks: [], runs: runs.map((each) => ({ run: each, jobs: [] })) })

function view(overrides: Partial<CiView> = {}): CiView {
  return {
    kind: 'forgejo',
    remote: 'origin',
    repository: 'john/app',
    counted: true,
    url: 'https://ci.example.com',
    health: 'ok',
    error: null,
    checkedAt: NOW.toISOString(),
    current: push(run()),
    history: [],
    medians: {},
    pushed: null,
    ...overrides,
  }
}

describe('ciLevel', () => {
  it('follows the current push', () => {
    expect(ciLevel(view(), NOW)).toBe('success')
    expect(ciLevel(view({ current: push(run({ status: 'failure' })) }), NOW)).toBe('failure')
    expect(ciLevel(view({ current: push(run({ status: 'running', stoppedAt: null })) }), NOW)).toBe('running')
    expect(ciLevel(view({ current: push(run({ status: 'cancelled' })) }), NOW)).toBe('idle')
    expect(ciLevel(view({ current: null }), NOW)).toBe('idle')
  })

  it('is at work while any workflow of the push is, and red once one fails (BTN-828)', () => {
    const running = run({ id: 2, workflow: 'macOS', status: 'running', stoppedAt: null })
    expect(ciLevel(view({ current: push(run(), running) }), NOW)).toBe('running')
    expect(ciLevel(view({ current: push(run({ status: 'failure' }), running) }), NOW)).toBe('failure')
  })

  it('takes a run no runner took for runs not taken, not red (BTN-761)', () => {
    expect(ciLevel(view({ current: push(run({ status: 'failure', notTaken: true })) }), NOW)).toBe('stuck')
  })

  it('counts a fresh push as running and a stale one as stuck', () => {
    expect(ciLevel(view({ pushed: { commit: 'def', at: '2026-10-12T11:59:30Z' } }), NOW)).toBe('running')
    expect(ciLevel(view({ pushed: { commit: 'def', at: '2026-10-12T11:50:00Z' } }), NOW)).toBe('stuck')
  })

  it('puts the health first', () => {
    expect(ciLevel(view({ health: 'error' }), NOW)).toBe('error')
    expect(ciLevel(view({ health: 'off', current: null }), NOW)).toBe('off')
  })
})

describe('worstCiLevel', () => {
  it('shows what needs a look first', () => {
    expect(worstCiLevel([view(), view({ current: push(run({ status: 'failure' })) })], NOW)).toBe('failure')
    expect(worstCiLevel([view({ health: 'off' }), view()], NOW)).toBe('off')
    expect(worstCiLevel([view(), view({ health: 'error' })], NOW)).toBe('error')
  })

  it('leaves a CI the project does not count out while another is counted (BTN-828)', () => {
    const uncounted = view({ counted: false, current: push(run({ status: 'failure' })) })
    expect(worstCiLevel([view(), uncounted], NOW)).toBe('success')
    expect(worstCiLevel([uncounted], NOW)).toBe('failure')
  })
})
