import { describe, expect, it, vi } from 'vitest'
import { splitUserMessage } from '../chain/user-message.js'
import { launchBriefs, wireBriefed } from './chain-prompts.js'
import type { ChainContext } from './chain.js'
import { wireMachine } from './machine-chain.js'
import type { MachineContext } from './machine-context.js'

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
      intake: { outsider: () => false },
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
      intake: { outsider: () => false },
    }) as unknown as ChainContext
    const sent = await wireBriefed(ctx(true)).prepare('ABC-1', 'p1')
    expect(index).toHaveBeenCalledExactlyOnceWith('p1')
    expect(sent.prompt).toMatch(/memory_write.*\n- tests-need-docker — the e2e tests need Docker running\n$/s)
    const without = await wireBriefed(ctx(false)).prepare('ABC-1', 'p1')
    expect(without.prompt).not.toContain('memory_write')
    expect(index).toHaveBeenCalledTimes(1)
  })

  it("vouches for a task that is not an outsider's, asked of the intake at every brief, a retained one too (BTN-1419)", async () => {
    let outsider = false
    const ctx = {
      projectOf: () => 'p1', readerFor: () => 'p1', promptLanguage: () => 'en',
      readers: () => ({ keys: { p1: 'ABC' }, trackers: {} }),
      configStore: { current: { feeds: {} } },
      trackerPlace: () => null,
      briefOn: () => false,
      packages: { bringsServer: () => false },
      intake: { outsider: (project: string, task: string) => project === 'p1' && task === 'ABC-1' && outsider },
    } as unknown as ChainContext
    const hub = wireBriefed(ctx)
    expect((await hub.prepare('ABC-1', 'p1')).own).toBe(true)
    outsider = true
    expect((await hub.prepare('ABC-1', 'p1', true)).own).toBeUndefined()
    expect((await hub.prepare('ABC-1', 'p1')).own).toBeUndefined()
  })

  it("tells on the machine whether the last brief received vouched for the task; none kept is an outsider's (BTN-1419)", () => {
    const briefed = launchBriefs()
    expect(briefed.own('ABC-1')).toBe(false)
    briefed.apply('ABC-1', '', { prompt: 'Task text', own: true })
    expect(briefed.own('ABC-1')).toBe(true)
    briefed.apply('ABC-1', 'Handoff')
    expect(briefed.own('ABC-1')).toBe(true)
    briefed.apply('ABC-1', '', { prompt: 'Task text' })
    expect(briefed.own('ABC-1')).toBe(false)
    expect(briefed.own('ABC-2')).toBe(false)
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

  it("refuses a chain task's prompt without a brief from the hub or one kept, rather than a prompt without the task (BTN-1252)", () => {
    const briefed = launchBriefs()
    expect(() => briefed.apply('ABC-1', 'Start')).toThrow(expect.objectContaining({ notice: { code: 'chain.briefMissing', params: { task: 'ABC-1' } } }))
    expect(() => briefed.apply('ABC-1', 'Start', { prompt: '' })).toThrow(expect.objectContaining({ notice: { code: 'chain.briefMissing', params: { task: 'ABC-1' } } }))
    expect(briefed.apply('ABC-FIX', 'Fix the red main')).toBe('Fix the red main')
  })
})

describe('a session of a chain task on the machine without a brief (BTN-1252)', () => {
  const machineOf = () => {
    const launchIn = vi.fn(async () => 'session-1')
    const stopIn = vi.fn(async () => {})
    const ctx = {
      homeOf: () => ({ key: 'main', dir: 'C:/example/home' }),
      homes: { find: () => ({ key: 'main', dir: 'C:/example/home' }) },
      choiceFor: () => ({ account: 'main', model: 'example' }),
      daemons: { prepare: async () => {} },
      places: { ready: async () => ({ path: 'C:/example/repo/.claude/worktrees/abc-1', branch: 'abc-1/task' }) },
      promptLanguage: () => 'en',
      slotSpan: () => 0,
      branchOf: () => 'main',
      pullRequestsOn: () => false,
      configStore: { current: { settings: {} } },
      briefed: launchBriefs(),
      withProject: (prompt: string) => prompt,
      planFor: (_task: string, prompt: string) => ({ prompt, model: 'example', provider: 'claude', fallback: null }),
      agentExtras: () => ({}),
      settingsFor: async () => undefined,
      projectOf: () => 'p1',
      writes: { add: () => {} },
      launchIn,
      stopIn,
    } as unknown as MachineContext
    return { port: wireMachine(ctx, async () => {}), launchIn, stopIn }
  }

  it('pauses the launch with the code and starts no session', async () => {
    const { port, launchIn } = machineOf()
    await expect(port.launch('p1', 'ABC-1')).rejects.toThrow(expect.objectContaining({ notice: { code: 'chain.briefMissing', params: { task: 'ABC-1' } } }))
    expect(launchIn).not.toHaveBeenCalled()
  })

  it('pauses the handoff before it stops the previous session', async () => {
    const { port, launchIn, stopIn } = machineOf()
    const session = { sessionId: 'session-0', account: 'main', workdir: 'C:/example/repo/.claude/worktrees/abc-1', stopped: false }
    await expect(port.relay('ABC-1', session as never, 'Handoff', 'restart')).rejects.toThrow(expect.objectContaining({ notice: { code: 'chain.briefMissing', params: { task: 'ABC-1' } } }))
    expect(stopIn).not.toHaveBeenCalled()
    expect(launchIn).not.toHaveBeenCalled()
  })
})

describe("a handoff with the user's message (BTN-1423)", () => {
  const relayed = async (handoff: string, reason: 'message' | 'restart') => {
    const launchIn = vi.fn(async (_home: unknown, _start: { prompt: string }) => 'session-1')
    const ctx = {
      homeOf: () => ({ key: 'main', dir: 'C:/example/home' }),
      homes: { find: () => undefined },
      choiceFor: () => ({ account: 'main', model: 'example' }),
      daemons: { prepare: async () => {} },
      promptLanguage: () => 'en',
      briefed: launchBriefs(),
      withProject: (prompt: string) => `${prompt}\nProject rules\n`,
      planFor: (_task: string, prompt: string) => ({ prompt: `${prompt}\nUnattended rules\n\nModel prompt`, model: 'example', provider: 'claude', fallback: null }),
      agentExtras: () => ({}),
      settingsFor: async () => undefined,
      projectOf: () => undefined,
      writes: { add: () => {} },
      launchIn,
    } as unknown as MachineContext
    const session = { sessionId: 'session-0', account: 'main', workdir: 'C:/example/repo/.claude/worktrees/abc-1', checkpoint: null, stopped: true }
    await wireMachine(ctx, async () => {}).relay('ABC-1', session as never, handoff, reason, { prompt: '\nTask brief\n' })
    return launchIn.mock.calls[0]![1].prompt
  }

  it('ends the prompt with the message, after the brief and every setting\'s text, so the page splits off only the message', async () => {
    const prompt = await relayed("Handoff\n\nThe user's message:\n\nTry again\n", 'message')
    expect(prompt.endsWith("\n\nThe user's message:\n\nTry again\n")).toBe(true)
    expect(splitUserMessage(prompt)).toEqual({ handoff: 'Handoff\n\nTask brief\n\nProject rules\n\nUnattended rules\n\nModel prompt', message: 'Try again' })
  })

  it('leaves the other handoffs as they were', async () => {
    expect(await relayed('Handoff\n', 'restart')).toBe('Handoff\n\nTask brief\n\nProject rules\n\nUnattended rules\n\nModel prompt')
  })
})
