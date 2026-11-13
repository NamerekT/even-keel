import { expect, it, vi } from 'vitest'
import { fakeTask } from '../../src/tracker/fixture.js'
import { toTask } from '../../src/tracker/model.js'
import { createFakeSource } from './live/fake.js'
import { parentBlocks } from './parents.js'
import { chainBlocks } from './state.js'

it("shows a task's run from Even Keel's own records, never from its labels", () => {
  vi.useFakeTimers()
  try {
    const state = createFakeSource('?chain=idle').snapshot().state!
    const run = { provider: 'opencode', model: 'router/vendor/deepseek-v4-pro', effort: null }
    state.tasks = [
      { ...toTask(fakeTask('ABC-10', { labels: ['Codex | gpt-6.1-sol', 'Bug'] })), project: 'ABC' },
      { ...toTask(fakeTask('ABC-11', { labels: ['Claude | opus'] })), project: 'ABC' },
    ]
    state.runs = { ABC: { 'ABC-10': run }, XYZ: { 'ABC-11': { provider: 'claude', model: null, effort: 'high' } } }
    const blocks = chainBlocks(state, 'ABC')
    expect(blocks.find((block) => block.id === 'ABC-10')?.run).toEqual(run)
    expect(blocks.find((block) => block.id === 'ABC-11')?.run).toBeNull()
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})

it('shows the run of a parent task the same way', () => {
  vi.useFakeTimers()
  try {
    const state = createFakeSource('?chain=idle').snapshot().state!
    const [parent] = state.parents?.ABC ?? []
    expect(parent).toBeDefined()
    const run = { provider: null, model: null, effort: 'low' }
    state.runs = { ABC: { [parent!.id]: run } }
    expect(parentBlocks(state, 'ABC').find((block) => block.id === parent!.id)?.run).toEqual(run)
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})
