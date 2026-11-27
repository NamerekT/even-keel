import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { readLaunches } from '../chain/store.js'
import { DatabaseHubStore } from '../link/hub-store.js'
import { HubEnd } from '../link/hub.js'
import { FINGERPRINT, HUB_ADDRESS, MemoryMachineStore, Wire } from '../link/link.fixture.js'
import { MachineEnd } from '../link/machine.js'
import { bearerOf, parseToken } from '../link/protocol.js'
import type { Mail } from '../sessions/mail.js'
import { loadMail, Mailbox } from '../sessions/mailbox.js'
import { adoptMail, saveMailboxChange, type MailboxChange } from '../sessions/mailbox-store.js'
import { settleMail } from '../sessions/mailRelay.js'
import { Writes } from '../storage/database.js'
import { loadSessionWindows } from '../storage/context-windows.js'
import { memoryDatabase } from '../storage/memory.js'
import { readWarmPings } from '../sessions/warm-pings.js'
import { machineJournal, MachineRecords, MAILBOX_EVENT, saveMachineRecord, WARM_EVENT } from './records.js'
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
  it('keeps offline key spend on the hub once after a lost confirmation', async () => {
    const { db, records, end, wire, store } = await bench()
    end.stop()
    await records.spend({ sessionId: 'session-1', account: 'key', usd: 0.25, shared: false, at: entry.at })
    expect((await db.query('select * from key_spends')).rows).toEqual([])
    await end.start()
    await vi.waitFor(() => expect(end.status().state).toBe('online'))
    await end.flushed()
    wire.loseAnswers = true
    await records.spend({ sessionId: 'session-1', account: 'key', usd: 0.15, shared: false, at: entry.at })
    await end.flushed()
    end.stop()
    wire.loseAnswers = false
    await end.start()
    await vi.waitFor(() => expect(end.status().state).toBe('online'))
    await end.flushed()
    expect((await db.query('select usd from key_spends')).rows).toEqual([{ usd: 0.4 }])
    expect(store.outbox).toEqual([])
  })

  it("keeps a keep-warm ping on the hub under the machine that sent it, once after a lost answer", async () => {
    const { db, end, wire, machine } = await bench()
    const ping = { at: entry.at, sessionId: 'session-1', task: 'ABC-1', project: null, account: 'key', model: 'claude-opus-5-5', input: 3, cacheWrite5m: 10, cacheWrite1h: 0, cacheRead: 90_000, output: 4 }
    wire.loseAnswers = true
    await end.emit(WARM_EVENT, ping)
    await end.flushed()
    end.stop()
    wire.loseAnswers = false
    await end.start()
    await vi.waitFor(() => expect(end.status().state).toBe('online'))
    await end.flushed()
    expect(await readWarmPings(db)).toEqual([{ ...ping, machine }])
  })

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
    restarted.restore(await loadMail(db))
    expect(restarted.delivered('session-1')).toHaveLength(1)
    expect(restarted.post('ABC-2', 'session-2', 'Next message.', []).id).toBeGreaterThan(mail.id)
  })
})

describe('mailbox records of several machines', { timeout: 30_000 }, () => {
  const settled = (id: number, sessionId: string, settledAt: string): Mail => ({
    id, task: 'ABC-1', sessionId, text: `Message ${id}.`, files: [], postedAt: settledAt, fate: 'delivered', event: 'Stop', reason: null, settledAt,
  })

  async function pool() {
    const db = await memoryDatabase()
    const hub = new HubEnd({ store: new DatabaseHubStore(db), handlers: {}, log: () => {} })
    onTestFinished(() => hub.stop())
    const a = parseToken(await hub.issue('Machine A', HUB_ADDRESS, FINGERPRINT))!.machine
    const b = parseToken(await hub.issue('Machine B', HUB_ADDRESS, FINGERPRINT))!.machine
    const seqs = new Map<string, number>()
    const send = (machine: string, payload: MailboxChange) => {
      const seq = (seqs.get(machine) ?? 0) + 1
      seqs.set(machine, seq)
      return saveMachineRecord(db, machine, { seq, type: MAILBOX_EVENT, at: 0, payload })
    }
    const ids = async () => (await loadMail(db)).map((mail) => mail.id)
    return { db, a, b, send, ids }
  }

  it("cleans up only the old settled mail of the machine that sent the cutoff", async () => {
    const { a, b, send, ids } = await pool()
    await send(a, { mails: [settled(1, 'session-a', '2026-11-01T10:00:00.000Z')] })
    await send(b, { mails: [settled(2, 'session-b', '2026-11-01T10:00:00.000Z')] })
    await send(a, { mails: [{ ...settled(3, 'session-a', '2026-11-16T10:00:00.000Z'), fate: 'waiting', event: null, settledAt: null }], before: '2026-11-09T10:00:00.000Z' })
    expect(await ids()).toEqual([2, 3])
  })

  it('cleans up the old mail kept before the mailbox knew its machines', async () => {
    const { db, a, send, ids } = await pool()
    await saveMailboxChange(db, { mails: [settled(1, 'session-a', '2026-11-01T10:00:00.000Z')] }, null)
    await send(a, { mails: [], before: '2026-11-09T10:00:00.000Z' })
    expect(await ids()).toEqual([])
  })

  it('keeps a settled message over a late change that still has it waiting', async () => {
    const { db, a, send } = await pool()
    const waiting: Mail = { ...settled(1, 'session-a', entry.at), fate: 'waiting', event: null, settledAt: null }
    await send(a, { mails: [waiting] })
    await send(a, { mails: [settled(1, 'session-a', entry.at)] })
    await send(a, { mails: [waiting] })
    await send(a, { mails: [{ ...settled(1, 'session-a', entry.at), fate: 'returned', event: null, reason: 'gone' }] })
    expect(await loadMail(db)).toEqual([settled(1, 'session-a', entry.at)])
  })

  it('keeps the same number posted on two machines as two messages, each settled by its own machine', async () => {
    const { db, a, b, send } = await pool()
    const waiting = (sessionId: string, text: string): Mail => ({ ...settled(1, sessionId, entry.at), text, fate: 'waiting', event: null, settledAt: null })
    await send(a, { mails: [waiting('session-a', 'To the first machine.')] })
    await send(b, { mails: [waiting('session-b', 'To the second machine.')] })
    await send(b, { mails: [{ ...waiting('session-b', 'To the second machine.'), fate: 'returned', reason: 'gone', settledAt: entry.at }] })
    expect(await loadMail(db, a)).toEqual([waiting('session-a', 'To the first machine.')])
    expect((await loadMail(db, b)).map((mail) => [mail.sessionId, mail.text, mail.fate])).toEqual([['session-b', 'To the second machine.', 'returned']])
  })

  it("hands a machine only its own mail, so its settling leaves another machine's waiting message alone", async () => {
    const { db, a, b, send } = await pool()
    const later = new Date(Date.parse(entry.at) + 60_000)
    const writes = new Writes(() => {})
    const mailboxOf = async (machine: string) => {
      const mailbox = Mailbox.detached(writes, () => later)
      mailbox.restore(await loadMail(db, machine))
      mailbox.persistWith(async (change) => { await send(machine, change) })
      return mailbox
    }
    const first = await mailboxOf(a)
    first.post('ABC-1', 'session-a', 'To the first machine.', [])
    await writes.settled()
    const second = await mailboxOf(b)
    expect(second.waiting()).toEqual([])
    expect(second.post('ABC-2', 'session-b', 'To the second machine.', []).id).toBe(1)
    await settleMail({
      mailbox: second,
      live: () => undefined,
      resume: async () => false,
      closed: async () => false,
      language: () => 'en',
      changed: () => {},
      log: () => {},
      now: () => new Date(later.getTime() + 60_000),
    })
    await writes.settled()
    expect((await loadMail(db, a)).map((mail) => mail.fate)).toEqual(['waiting'])
    expect((await loadMail(db, b)).map((mail) => [mail.fate, mail.reason])).toEqual([['returned', 'gone']])
  })

  it('gives the messages kept before rows knew their machine to the own machine', async () => {
    const { db, a, send } = await pool()
    await saveMailboxChange(db, { mails: [{ ...settled(1, 'session-a', entry.at), fate: 'waiting', event: null, settledAt: null }] }, null)
    await adoptMail(db, a)
    await send(a, { mails: [settled(1, 'session-a', entry.at)] })
    expect(await loadMail(db)).toEqual([settled(1, 'session-a', entry.at)])
    expect(await loadMail(db, a)).toEqual([settled(1, 'session-a', entry.at)])
  })

  it('dismisses a returned message and never brings it back', async () => {
    const { db, a, send } = await pool()
    const returned: Mail = { ...settled(1, 'session-a', entry.at), fate: 'returned', event: null, reason: 'asked' }
    await send(a, { mails: [{ ...returned, fate: 'waiting', reason: null, settledAt: null }] })
    await send(a, { mails: [returned] })
    await send(a, { mails: [{ ...returned, fate: 'dismissed' }] })
    await send(a, { mails: [returned] })
    expect((await loadMail(db)).map((mail) => mail.fate)).toEqual(['dismissed'])
  })
})

describe("a machine elsewhere's journal handed back", () => {
  const launch = (task: string, sessionId: string, at: string, machine?: string) => ({ at, project: 'example-project', task, sessionId, ...(machine !== undefined && { machine }) })
  const since = new Date('2026-11-10T00:00:00.000Z')

  it("keeps only the machine's own launches", () => {
    const own = launch('ABC-1', 'session-1', '2026-11-16T10:00:00.000Z', 'machine-1')
    const other = launch('ABC-2', 'session-2', '2026-11-16T10:00:00.000Z', 'machine-2')
    const hub = launch('ABC-3', 'session-3', '2026-11-16T10:00:00.000Z')
    expect(machineJournal([own, other, hub], 'machine-1', since, () => false)).toEqual([own])
  })

  it('keeps every launch of a task with one in the window or one the machine holds, and drops the tasks gone quiet', () => {
    const early = launch('ABC-1', 'session-1', '2026-11-01T10:00:00.000Z', 'machine-1')
    const late = launch('ABC-1', 'session-2', '2026-11-16T10:00:00.000Z', 'machine-1')
    const quiet = launch('ABC-2', 'session-3', '2026-11-02T10:00:00.000Z', 'machine-1')
    const held = launch('ABC-3', 'session-4', '2026-10-20T10:00:00.000Z', 'machine-1')
    const holds = (project: string, task: string) => project === 'example-project' && task === 'ABC-3'
    expect(machineJournal([held, early, quiet, late], 'machine-1', since, holds)).toEqual([held, early, late])
  })
})
