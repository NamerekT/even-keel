import { describe, expect, it } from 'vitest'
import type { MachineFacts } from '../machine/facts.js'
import { pageReads } from '../machine/page.js'
import type { MachineHistory, TaskSessionsHere } from '../machine/services.js'
import type { SessionView } from '../state.js'
import { historyReads, type HistoryMirror } from './task-history.js'

const view = (task: string, sessionId: string, account: string | null = null): SessionView =>
  ({ task, sessionId, lamp: 'finished', account, agent: 'claude', startedAt: '2026-11-01T10:00:00Z' }) as unknown as SessionView

const facts = (sessions: SessionView[] = []): MachineFacts =>
  ({
    tasks: {},
    sessions: Object.fromEntries(sessions.map((each) => [each.sessionId, each])),
    ledger: { work: { email: 'john.doe@example.com', previous: null, since: '2026-01-01T00:00:00Z' } },
    panel: { accounts: [{ key: 'work', agent: 'codex', status: { email: 'john.doe@example.com' } }] },
    limits: {},
  }) as unknown as MachineFacts

function mirror(machine: string, told: MachineFacts, history: MachineHistory | undefined): HistoryMirror {
  return { machine, facts: () => told, page: pageReads(() => told), history }
}

const here: TaskSessionsHere = { sessions: { old: view('ABC-9', 'old', 'jane.doe@example.com') }, owners: { old: 'work', gone: 'work' }, compactions: { old: 2 } }

describe('historyReads (BTN-1561)', () => {
  it("lays the task's sessions a machine elsewhere gave under its mirror", async () => {
    const asked: Array<[string, string[]]> = []
    const history: MachineHistory = { task: async (task, sessionIds) => (asked.push([task, sessionIds]), here) }
    const own = pageReads(() => facts([view('ABC-1', 'mine')]))
    const reads = await historyReads({ own, elsewhere: () => [mirror('m2', facts([view('ABC-2', 'live')]), history)], log: () => {} }, 'ABC-9', ['old', 'gone'])
    expect(asked).toEqual([['ABC-9', ['old', 'gone']]])
    expect(reads.sessions().map((each) => each.sessionId).sort()).toEqual(['live', 'mine', 'old'])
    expect(reads.sessionAccount('old', '2026-11-01T10:00:00Z')).toBe('jane.doe@example.com')
    expect(reads.sessionAgent('old')).toBe('claude')
    expect(reads.compactionsOf('old')).toBe(2)
    // A run whose transcript is gone keeps the account and the agent of its folder.
    expect(reads.sessionAccount('gone', '2026-11-01T10:00:00Z')).toBe('john.doe@example.com')
    expect(reads.sessionAgent('gone')).toBe('codex')
  })

  it('shows the mirror alone for a machine off the link, one that fails and one that does not answer in time', async () => {
    const lines: string[] = []
    const failing: MachineHistory = { task: async () => { throw new Error('refused') } }
    const silent: MachineHistory = { task: () => new Promise(() => {}) }
    const reads = await historyReads(
      {
        own: pageReads(() => undefined),
        elsewhere: () => [mirror('off', facts([view('ABC-9', 'a')]), undefined), mirror('bad', facts(), failing), mirror('slow', facts([view('ABC-9', 'b')]), silent)],
        log: (line) => lines.push(line),
        waitMs: 10,
      },
      'ABC-9',
      [],
    )
    expect(reads.sessions().map((each) => each.sessionId)).toEqual(['a', 'b'])
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('refused')
  })
})
