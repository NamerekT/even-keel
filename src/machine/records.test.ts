import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { readLaunches } from '../chain/store.js'
import { DatabaseHubStore } from '../link/hub-store.js'
import { HubEnd } from '../link/hub.js'
import { FINGERPRINT, HUB_ADDRESS, MemoryMachineStore, Wire } from '../link/link.fixture.js'
import { MachineEnd } from '../link/machine.js'
import { bearerOf, parseToken } from '../link/protocol.js'
import { Mailbox } from '../sessions/mailbox.js'
import { Writes } from '../storage/database.js'
import { loadSessionWindows } from '../storage/context-windows.js'
import { memoryDatabase } from '../storage/memory.js'
import { MachineRecords, saveMachineRecord } from './records.js'
import { RemoteMachine } from './remote.js'

const entry = { at: '2026-11-16T10:00:00.000Z', project: 'example-project', task: 'ABC-1', sessionId: 'session-1' }

async function bench() {
  const db = await memoryDatabase()
  const hubStore = new DatabaseHubStore(db)
  const applied: string[] = []
  let id = ''
  const remote = new RemoteMachine({
    machine: () => id,
    send: (machine, command) => hub.send(machine, command),
    projectOf: () => undefined,
    projectOfSession: () => undefined,
    lastSession: () => undefined,
    saveSnapshot: () => {},
    record: async (event) => {
      if (await saveMachineRecord(db, id, event)) applied.push(event.type)
    },
    log: () => {},
  })
  const hub: HubEnd = new HubEnd({
    store: hubStore,
    handlers: remote.handlers(),
    log: () => {},
  })
  const token = parseToken(await hub.issue('Example', HUB_ADDRESS, FINGERPRINT))!
  id = token.machine
  const store = new MemoryMachineStore()
  const wire = new Wire(hub, bearerOf(token))
  const end = new MachineEnd({ transport: wire, store, snapshot: () => ({}), command: async () => {}, log: () => {} })
  const records = new MachineRecords((type, payload) => end.emit(type, payload))
  const writes = new Writes(() => {})
  const mailbox = await Mailbox.open(db, writes, () => new Date(entry.at))
  mailbox.persistWith((change) => records.mailbox(change))
  onTestFinished(async () => { await writes.settled(); end.stop(); hub.stop() })
  await end.start()
  await vi.waitFor(() => expect(end.status().state).toBe('online'))
  return { db, hub, hubStore, store, wire, end, records, mailbox, writes, applied, machine: token.machine }
}

describe('machine records over the wire', { timeout: 30_000 }, () => {
  it('keeps journal entries, session windows and chat changes at the hub', async () => {
    const { db, records, end, mailbox, writes } = await bench()
    await records.launch(entry)
    await records.windows([['session-1', 200_000]], 123)
    const mail = mailbox.post('ABC-1', 'session-1', 'Continue here.', [])
    mailbox.settle([mail], 'delivered', 'PostToolUse')
    await writes.settled()
    await end.flushed()
    expect(await readLaunches(db)).toEqual([entry])
    expect(await loadSessionWindows(db)).toEqual([['session-1', 200_000]])
    const reopened = await Mailbox.open(db, writes, () => new Date(entry.at))
    expect(reopened.delivered('session-1')).toEqual([{ ...mail, fate: 'delivered', event: 'PostToolUse', settledAt: entry.at }])
  })

  it('keeps offline records until reconnect and does not repeat them after a lost answer', async () => {
    const { db, records, end, wire, store } = await bench()
    end.stop()
    await records.launch(entry)
    expect(await readLaunches(db)).toEqual([])
    await end.start()
    await vi.waitFor(() => expect(end.status().state).toBe('online'))
    await end.flushed()
    wire.loseAnswers = true
    const second = { ...entry, reason: 'resume' as const }
    await records.launch(second)
    await end.flushed()
    expect(await readLaunches(db)).toEqual([entry, second])
    expect(store.outbox.length).toBeGreaterThan(0)
    end.stop()
    wire.loseAnswers = false
    await end.start()
    await vi.waitFor(() => expect(end.status().state).toBe('online'))
    await end.flushed()
    expect(await readLaunches(db)).toEqual([entry, second])
    expect(store.outbox).toEqual([])
  })

  it('commits the event cursor with its record even if the separate confirmation fails', async () => {
    const { db, records, end, hubStore, store, machine } = await bench()
    const confirm = vi.spyOn(hubStore, 'eventTaken').mockRejectedValueOnce(new Error('confirmation lost'))
    await records.launch(entry)
    await end.flushed()
    expect(await readLaunches(db)).toEqual([entry])
    expect((await hubStore.machine(machine))?.lastEvent).toBe(1)
    const event = store.outbox[0]!
    expect(await saveMachineRecord(db, machine, event)).toBe(false)
    expect(await readLaunches(db)).toEqual([entry])
    confirm.mockRestore()
  })

  it('delivers chat changes queued after a lost answer without repeating the message', async () => {
    const { db, end, wire, mailbox, writes } = await bench()
    wire.loseAnswers = true
    const mail = mailbox.post('ABC-1', 'session-1', 'Continue here.', [])
    await writes.settled()
    await end.flushed()
    end.stop()
    mailbox.settle([mail], 'delivered', 'Stop')
    await writes.settled()
    wire.loseAnswers = false
    await end.start()
    await vi.waitFor(() => expect(end.status().state).toBe('online'))
    await end.flushed()
    const reopened = await Mailbox.open(db, writes, () => new Date(entry.at))
    expect(reopened.of('session-1')).toEqual([{ ...mail, fate: 'delivered', event: 'Stop', settledAt: entry.at }])
  })

  it('rolls back a failed record with its cursor and accepts the retry', async () => {
    const { db, records, end, hubStore, machine } = await bench()
    await db.exec('alter table launches rename to unavailable_launches')
    await records.launch(entry)
    await end.flushed()
    expect((await hubStore.machine(machine))?.lastEvent).toBe(0)
    await db.exec('alter table unavailable_launches rename to launches')
    await end.flushed()
    expect(await readLaunches(db)).toEqual([entry])
    expect((await hubStore.machine(machine))?.lastEvent).toBe(1)
  })

  it('reloads the mailbox after replaying records left by the previous process', async () => {
    const { db, end, mailbox, writes } = await bench()
    end.stop()
    const mail = mailbox.post('ABC-1', 'session-1', 'Kept offline.', [])
    mailbox.settle([mail], 'delivered', 'Stop')
    await writes.settled()
    const restarted = await Mailbox.open(db, writes, () => new Date(entry.at))
    expect(restarted.of('session-1')).toEqual([])
    await end.start()
    await vi.waitFor(() => expect(end.status().state).toBe('online'))
    await end.flushed()
    await restarted.reload(db)
    expect(restarted.delivered('session-1')).toHaveLength(1)
    expect(restarted.post('ABC-2', 'session-2', 'Next message.', []).id).toBeGreaterThan(mail.id)
  })
})
