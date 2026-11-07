import { describe, expect, it, vi } from 'vitest'
import type { SessionView } from '../state.js'
import { RARE_KEEP_MS, RareEvents, type RareRecord } from './rare.js'

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

  function restarted(records: RareRecord[], now: number) {
    const log = vi.fn()
    const rare = new RareEvents(log)
    rare.projectOf = () => 'project-1'
    const store = { save: vi.fn<(record: RareRecord) => void>(), prune: vi.fn<(before: number) => void>() }
    rare.restore(records, store, now)
    return { rare, log, store }
  }

  it('saves each new key and does not repeat a reported event after a restart', () => {
    const first = restarted([], at)
    first.rare.once('46', 'turn-1', view(), 'background-blocked')
    first.rare.once('46', 'turn-1', view(), 'again')
    expect(first.store.save).toHaveBeenCalledTimes(1)
    const saved = first.store.save.mock.calls.map(([record]) => record)
    expect(saved[0]).toMatchObject({ entry: '46', event: 'turn-1', sessionId: 's1' })
    expect(saved[0]!.waiting).toBeUndefined()

    const second = restarted(saved, at + 60_000)
    second.rare.once('46', 'turn-1', view(), 'again')
    second.rare.once('46', 'turn-2', view(), 'next')
    expect(second.log).toHaveBeenCalledTimes(1)
    expect(second.log.mock.calls[0]![0]).toContain('next')
  })

  it('writes the outcome of a copy that was still waiting for its transcript before the restart', () => {
    const first = restarted([], at)
    first.rare.copy('old', view(), at, false, at + 1000)
    const saved = first.store.save.mock.calls.map(([record]) => record)
    expect(saved).toHaveLength(1)
    expect(saved[0]!.waiting).toMatchObject({ kind: 'transcript', old: 'old', since: at })

    const second = restarted(JSON.parse(JSON.stringify(saved)) as RareRecord[], at + 5000)
    second.rare.copy('old', view(), at, false, at + 6000)
    second.rare.observe(view({ lamp: 'working' }), true, at + 7000)
    second.rare.observe(view({ lamp: 'working' }), true, at + 8000)
    expect(second.log).toHaveBeenCalledTimes(1)
    expect(second.log.mock.calls[0]![0]).toContain('transcript-appeared oldSession="old" elapsedMs=7000')
    expect(second.log.mock.calls[0]![0]).toContain('project="project-1" task="ABC-1" session="s1"')
    const settled = second.store.save.mock.calls.map(([record]) => record)
    expect(settled.find((record) => record.event === `copy:old:${at}`)?.waiting).toBeUndefined()
    expect(settled.some((record) => record.event === `transcript:old:${at}`)).toBe(true)

    const third = restarted([...saved, ...settled], at + 9000)
    third.rare.observe(view({ lamp: 'working' }), true, at + 10_000)
    expect(third.log).not.toHaveBeenCalled()
  })

  it('writes the first answer of a session that was idle before its prompt when the service restarted', () => {
    const first = restarted([], at)
    first.rare.observe(view(), false, at + 1000)
    const saved = first.store.save.mock.calls.map(([record]) => record)
    expect(saved[0]!.waiting).toEqual({ kind: 'answer' })

    const second = restarted(saved, at + 2000)
    second.rare.observe(view(), false, at + 3000)
    expect(second.log).not.toHaveBeenCalled()
    second.rare.observe(view({ feed: [{ kind: 'text', at: '', text: 'Hello' }] }), true, at + 4000)
    second.rare.observe(view({ feed: [{ kind: 'text', at: '', text: 'Hello' }] }), true, at + 5000)
    expect(second.log).toHaveBeenCalledTimes(1)
    expect(second.log.mock.calls[0]![0]).toContain('first-answer elapsedMs=4000')
  })

  it('forgets keys past the keeping term and asks the store to drop them', () => {
    const old = { entry: '46', event: 'turn-1', sessionId: 's1', seenAt: at - RARE_KEEP_MS - 1 }
    const { rare, log, store } = restarted([old], at)
    expect(store.prune).toHaveBeenCalledWith(at - RARE_KEEP_MS)
    rare.once('46', 'turn-1', view(), 'again')
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('goes on when the store fails', () => {
    const log = vi.fn()
    const rare = new RareEvents(log)
    rare.restore([], { save: () => { throw new Error('disk full') }, prune: () => {} }, at)
    expect(rare.once('46', 'turn-1', view(), 'background-blocked')).toBe(true)
    expect(rare.once('46', 'turn-1', view(), 'again')).toBe(false)
    expect(log.mock.calls.map(([line]) => line as string).filter((line) => line.startsWith('rare:'))).toHaveLength(1)
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
