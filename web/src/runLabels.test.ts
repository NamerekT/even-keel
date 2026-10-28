import { expect, it, vi } from 'vitest'
import { fakeTask } from '../../src/tracker/fixture.js'
import { toTask } from '../../src/tracker/model.js'
import { createFakeSource } from './live/fake.js'
import { chainBlocks } from './state.js'

it('keeps tracker spelling and full model paths for chain run labels and their titles', () => {
  vi.useFakeTimers()
  try {
    const state = createFakeSource('?chain=idle').snapshot().state!
    const labels = ['oPeNcOdE | router/vendor/deepseek-v4-pro', 'Bug', 'Codex']
    state.tasks = [{ ...toTask(fakeTask('ABC-10', { labels })), project: 'ABC' }]
    expect(chainBlocks(state, 'ABC').find((block) => block.id === 'ABC-10')?.runLabels).toEqual([labels[0], labels[2]])
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})
