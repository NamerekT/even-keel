import { describe, expect, it, vi } from 'vitest'
import { wireBriefed } from './chain-prompts.js'
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
      linkOf: () => ({ run: async (call: (tracker: { brief: typeof read }) => unknown) => call({ brief: read }) }),
    } as unknown as ChainContext
    const hub = wireBriefed(ctx)
    const sent = await hub.prepare('ABC-1', 'p1')
    expect(read).toHaveBeenCalledExactlyOnceWith('ABC-1')
    expect(sent.task).toEqual(task)
    expect(sent.prompt).toContain('Task text')
    expect(sent.prompt).toContain('Example tracker')
    expect(hub.kept('ABC-1')).toBeUndefined()
    expect(await hub.prepare('ABC-1', 'p1', true)).toEqual(sent)
    expect(read).toHaveBeenCalledTimes(1)
    await hub.prepare('ABC-1', 'p1')
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('keeps the received task and prompt for a handoff without reading a tracker', () => {
    const readerFor = vi.fn(() => { throw new Error('No tracker on a machine') })
    const briefed = wireBriefed({ readerFor } as unknown as ChainContext)
    const sent = { prompt: '\nTracker terms\nTask text\n', task: { title: 'Example task', description: 'Task text' } }
    expect(briefed.apply('ABC-1', 'Start', sent)).toBe('Start' + sent.prompt)
    expect(briefed.kept('ABC-1')).toEqual(sent.task)
    expect(briefed.apply('ABC-1', 'Handoff')).toBe('Handoff' + sent.prompt)
    expect(readerFor).not.toHaveBeenCalled()
  })

  it('replaces an old task brief when the next launch has no task text', () => {
    const briefed = wireBriefed({} as ChainContext)
    briefed.apply('ABC-1', '', { prompt: 'Old', task: { title: 'Old', description: 'Old' } })
    briefed.apply('ABC-1', '', { prompt: 'Read ABC-1 with tasks' })
    expect(briefed.kept('ABC-1')).toBeUndefined()
    expect(briefed.apply('ABC-1', 'Handoff')).toBe('HandoffRead ABC-1 with tasks')
  })
})
