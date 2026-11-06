import { describe, expect, it } from 'vitest'
import { notice } from '../notice/notice.js'
import { EVENT_LOG_LIMIT, EventLog, type EventStore } from './log.js'
import type { EventEntry } from './model.js'
import type { EventMemory, WatchInput } from './watch.js'

const quiet: WatchInput = {
  config: { shared: { ci: { guard: true, kinds: [] } }, projects: {} },
  chain: { active: [], projects: {}, leftovers: {}, skipped: {} },
  ci: {},
  fixes: {},
  sessions: [],
  tasks: [],
  forwards: {},
  works: {},
  cliVersions: [],
  packages: { gateway: null },
  configError: null,
}
const running = { ...quiet, chain: { ...quiet.chain, active: [{ project: 'p1', current: null, paused: false, error: null }] } } as WatchInput

function store() {
  const saved: EventEntry[] = []
  const pruned: string[] = []
  const memories: EventMemory[] = []
  const calls: EventStore = { save: (entry) => saved.push(entry), prune: (below) => pruned.push(below), remember: (memory) => memories.push(memory) }
  return { calls, saved, pruned, memories }
}

describe('EventLog', () => {
  it('numbers its entries on from the last one loaded, saves each and says it changed', () => {
    const kept = { id: '7', at: '2026-11-05T09:00:00.000Z', level: 'info' as const, notice: notice('eventLog.settings', {}), place: null }
    const { calls, saved } = store()
    let told = 0
    const log = new EventLog({ entries: [kept], memory: null }, calls, () => new Date('2026-11-05T12:00:00.000Z'), () => told++)
    log.add({ level: 'info', notice: notice('eventLog.launch', { task: 'ABC-1' }), place: null })
    expect(log.entries.map((entry) => entry.id)).toEqual(['7', '8'])
    expect(saved).toEqual([{ id: '8', at: '2026-11-05T12:00:00.000Z', level: 'info', notice: notice('eventLog.launch', { task: 'ABC-1' }), place: null }])
    expect(told).toBe(1)
  })

  it('keeps the newest entries only, and has the store drop the older ones', () => {
    const { calls, pruned } = store()
    const log = new EventLog({ entries: [], memory: null }, calls)
    for (let index = 0; index < EVENT_LOG_LIMIT + 2; index++) log.add({ level: 'info', notice: notice('eventLog.settings', {}), place: null })
    expect(log.entries).toHaveLength(EVENT_LOG_LIMIT)
    expect(log.entries[0]!.id).toBe('3')
    expect(pruned.at(-1)).toBe('3')
  })

  it('writes what changed between looks at the state and remembers it only when it changed', () => {
    const { calls, memories } = store()
    const log = new EventLog({ entries: [], memory: null }, calls)
    log.observe(quiet)
    log.observe(quiet)
    expect(memories).toHaveLength(1)
    log.observe(running)
    expect(log.entries.map((entry) => entry.notice.code)).toEqual(['eventLog.chainStarted'])
    expect(memories).toHaveLength(2)
  })

  it('takes what it remembered before a restart as seen at the start, however long ago it was seen', () => {
    const memory = { seen: { 'conflict|p1|p2': '2026-10-01T00:00:00.000Z' }, chains: {} }
    const hold = notice('forward.conflict', { from: 'p1', into: 'p2', files: ['a.ts'] })
    const log = new EventLog({ entries: [], memory }, store().calls, () => new Date('2026-11-05T12:00:00.000Z'))
    log.observe({ ...quiet, forwards: { p1: { into: 'p2', behind: 1, hold, held: true } } } as WatchInput)
    expect(log.entries).toEqual([])
  })

  it('writes a change of the settings against the last ones seen, none for the first', () => {
    const log = new EventLog({ entries: [], memory: null }, store().calls)
    log.settingsSeen({ version: 28, projects: [] })
    log.settingsSeen({ version: 28, parallel: 2, projects: [] })
    expect(log.entries.map((entry) => entry.notice.code)).toEqual(['eventLog.settings'])
  })
})
