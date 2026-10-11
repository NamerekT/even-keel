import { describe, expect, it } from 'vitest'
import type { CiRun, CiView } from '../../src/ci/model.js'
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

function view(overrides: Partial<CiView> = {}): CiView {
  return {
    kind: 'forgejo',
    remote: 'origin',
    url: 'https://ci.example.com',
    health: 'ok',
    error: null,
    checkedAt: NOW.toISOString(),
    current: { run: run(), tasks: [], jobs: [] },
    history: [],
    medianMs: null,
    pushed: null,
    ...overrides,
  }
}

describe('ciLevel', () => {
  it('follows the current run', () => {
    expect(ciLevel(view(), NOW)).toBe('success')
    expect(ciLevel(view({ current: { run: run({ status: 'failure' }), tasks: [], jobs: [] } }), NOW)).toBe('failure')
    expect(ciLevel(view({ current: { run: run({ status: 'running', stoppedAt: null }), tasks: [], jobs: [] } }), NOW)).toBe('running')
    expect(ciLevel(view({ current: { run: run({ status: 'cancelled' }), tasks: [], jobs: [] } }), NOW)).toBe('idle')
    expect(ciLevel(view({ current: null }), NOW)).toBe('idle')
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
    expect(worstCiLevel([view(), view({ current: { run: run({ status: 'failure' }), tasks: [], jobs: [] } })], NOW)).toBe('failure')
    expect(worstCiLevel([view({ health: 'off' }), view()], NOW)).toBe('off')
    expect(worstCiLevel([view(), view({ health: 'error' })], NOW)).toBe('error')
  })
})
