import { describe, expect, it, vi } from 'vitest'
import type { SessionView } from '../state.js'
import { RareEvents } from './rare.js'

const at = Date.parse('2026-11-07T10:00:00Z')
const view = (patch: Partial<SessionView> = {}): SessionView => ({
  task: 'ABC-1', sessionId: 's1', cwd: '/repo', lamp: 'waiting', startedAt: new Date(at).toISOString(),
  contextTokens: 0, feed: [], asking: false, startupDialog: null, apiError: null, ...patch,
} as SessionView)

describe('rare event diagnostics', () => {
  function setup() {
    const log = vi.fn()
    const rare = new RareEvents(log)
    rare.projectOf = () => 'project-1'
    return { rare, log }
  }

  it('records boot waiting once and a real model answer once, even past the boot window', () => {
    const { rare, log } = setup()
    rare.observe(view(), false, at + 1000)
    rare.observe(view(), false, at + 2000)
    rare.observe(view({ feed: [{ kind: 'prompt', at: '', text: 'Go' }] }), true, at + 3000)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]![0]).toContain('rare: 86')
    expect(log.mock.calls[0]![0]).toContain('elapsedMs=1000')
    const answer = view({ feed: [{ kind: 'tool', at: '', text: 'Read' }] })
    rare.observe(answer, true, at + 400_000)
    rare.observe(answer, true, at + 401_000)
    expect(log).toHaveBeenCalledTimes(2)
    expect(log.mock.calls[1]![0]).toContain('first-answer')
    expect(log.mock.calls[0]![0]).toContain('project="project-1" task="ABC-1" session="s1"')
  })

  it.each([
    { lamp: 'working' as const }, { contextTokens: 1 }, { asking: true }, { startupDialog: 'approve' },
    { apiError: 'failed' }, { feed: [{ kind: 'prompt' as const, at: '', text: 'Go' }] },
    { startedAt: new Date(at - 300_001).toISOString() },
    { startedAt: 'invalid' },
  ])('does not report boot waiting with %j', (patch) => {
    const { rare, log } = setup()
    rare.observe(view(patch), false, at)
    expect(log).not.toHaveBeenCalled()
  })

  it('records a copied resume and its late transcript only once, without calling it an answer', () => {
    const { rare, log } = setup()
    rare.copy('old', view(), at, false, at + 1000)
    rare.observe(view({ lamp: 'working' }), false, at + 2000)
    rare.observe(view({ lamp: 'working' }), true, at + 3000)
    rare.observe(view({ lamp: 'working' }), true, at + 4000)
    expect(log).toHaveBeenCalledTimes(2)
    expect(log.mock.calls[0]![0]).toContain('oldSession="old" transcript=false elapsedMs=1000')
    expect(log.mock.calls[1]![0]).toContain('transcript-appeared oldSession="old" elapsedMs=3000')
  })

  it('does not report an in-place resume or repeat a copy with an existing transcript', () => {
    const { rare, log } = setup()
    rare.copy('s1', view(), at, true, at + 1000)
    rare.copy('old', view(), at, true, at + 1000)
    rare.copy('old', view(), at, true, at + 2000)
    rare.observe(view({ lamp: 'working' }), true, at + 3000)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]![0]).toContain('transcript=true')
  })

  it('keeps details on one line, reports missing identity and suppresses repeated event keys', () => {
    const { rare, log } = setup()
    rare.projectOf = () => undefined
    rare.once('46', 'turn-1', { sessionId: 's1', cwd: '/repo' }, 'background-blocked detail=' + JSON.stringify('press\nbutton'))
    rare.once('46', 'turn-1', view(), 'again')
    rare.once('46', 'turn-2', view(), 'next')
    expect(log).toHaveBeenCalledTimes(2)
    expect(log.mock.calls[0]![0]).toContain('project="unknown" task="unknown"')
    expect(log.mock.calls[0]![0]).not.toContain('\n')
  })
})
