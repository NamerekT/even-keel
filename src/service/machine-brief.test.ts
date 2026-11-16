import { describe, expect, it, vi } from 'vitest'
import { launchBriefs, wireBriefed } from './chain-prompts.js'
import type { ChainContext } from './chain.js'

describe('a brief carried from the hub', () => {
  it('reads the task on the hub without adding it to the machine cache', async () => {
    const task = { title: 'Example', description: 'Task text' }
    const read = vi.fn(async () => task)
    const ctx = {
      projectOf: () => 'p1', readerFor: () => 'p1', promptLanguage: () => 'en',
      readers: () => ({ keys: { p1: 'ABC' }, trackers: {} }),
      configStore: { current: { feeds: {} } },
      trackerPlace: () => ({ title: 'Example tracker', project: 'example' }),
      briefOn: () => true,
      packages: { bringsServer: () => false },
      linkOf: () => ({ run: async (call: (tracker: { brief: typeof read }) => unknown) => call({ brief: read }) }),
    } as unknown as ChainContext
    const hub = wireBriefed(ctx)
    const sent = await hub.prepare('ABC-1', 'p1')
    expect(read).toHaveBeenCalledExactlyOnceWith('ABC-1')
    expect(sent.task).toEqual(task)
    expect(sent.prompt).toContain('Task text')
    expect(sent.prompt).toContain('Example tracker')
    expect('kept' in hub).toBe(false)
    expect(await hub.prepare('ABC-1', 'p1', true)).toEqual(sent)
    expect(read).toHaveBeenCalledTimes(1)
    await hub.prepare('ABC-1', 'p1')
    expect(read).toHaveBeenCalledTimes(2)
  })

  it("carries the project memory's index when the project's set brings the memory server (BTN-1029)", async () => {
    const index = vi.fn(async () => ['- tests-need-docker — the e2e tests need Docker running'])
    const ctx = (memory: boolean) => ({
      projectOf: () => 'p1', readerFor: () => 'p1', promptLanguage: () => 'en',
      readers: () => ({ keys: { p1: 'ABC' }, trackers: {} }),
      configStore: { current: { feeds: {} } },
      trackerPlace: () => null,
      briefOn: () => false,
      packages: { bringsServer: (_project: string, server: string) => memory && server === 'memory' },
      memory: { index },
    }) as unknown as ChainContext
    const sent = await wireBriefed(ctx(true)).prepare('ABC-1', 'p1')
    expect(index).toHaveBeenCalledExactlyOnceWith('p1')
    expect(sent.prompt).toMatch(/memory_write.*\n- tests-need-docker — the e2e tests need Docker running\n$/s)
    const without = await wireBriefed(ctx(false)).prepare('ABC-1', 'p1')
    expect(without.prompt).not.toContain('memory_write')
    expect(index).toHaveBeenCalledTimes(1)
  })

  it('keeps on the machine the received task and prompt for a handoff, with no tracker there', () => {
    const briefed = launchBriefs()
    const sent = { prompt: '\nTracker terms\nTask text\n', task: { title: 'Example task', description: 'Task text' } }
    expect(briefed.apply('ABC-1', 'Start', sent)).toBe('Start' + sent.prompt)
    expect(briefed.kept('ABC-1')).toEqual(sent.task)
    expect(briefed.apply('ABC-1', 'Handoff')).toBe('Handoff' + sent.prompt)
  })

  it('replaces an old task brief when the next launch has no task text', () => {
    const briefed = launchBriefs()
    briefed.apply('ABC-1', '', { prompt: 'Old', task: { title: 'Old', description: 'Old' } })
    briefed.apply('ABC-1', '', { prompt: 'Read ABC-1 with tasks' })
    expect(briefed.kept('ABC-1')).toBeUndefined()
    expect(briefed.apply('ABC-1', 'Handoff')).toBe('HandoffRead ABC-1 with tasks')
  })
})
