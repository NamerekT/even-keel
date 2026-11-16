import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, noticeOf } from '../notice/notice.js'
import type { AccountControl } from '../server-control.js'
import { MachineRecords } from './records.js'
import { bench, PROJECT, REPO, tick } from './remote.fixture.js'
import { fromCarried, remoteServices, toCarried, type MachineServices, type RetainedRecords } from './services.js'

/** The machine's own services: each member records its call and answers from `answers`. */
function machineServices() {
  const calls: Array<[string, unknown[]]> = []
  const answers: Record<string, unknown> = {}
  const services = remoteServices(async (group, name, args) => {
    calls.push([`${group}.${name}`, args])
    const answer = answers[`${group}.${name}`]
    if (answer instanceof Error) throw answer
    return answer
  })
  return { services, calls, answers }
}

describe('the services of the machine over the link', () => {
  let stop: Array<() => void> = []

  const started = async () => {
    const machine = machineServices()
    const made = await bench(undefined, undefined, machine.services)
    const booted = made.boot('first')
    stop.push(() => booted.end.stop(), () => made.hub.stop())
    await booted.end.start()
    await tick()
    return { ...made, ...booted, ...machine, remote: made.remote.services() }
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    for (const each of stop) each()
    stop = []
    vi.useRealTimers()
  })

  it('makes the account controls on the machine, and their notice comes back by its code', async () => {
    const { remote, calls, answers, ran } = await started()
    await remote.account.add('claude', 'console')
    await remote.account.rename('work', '')
    expect(calls).toEqual([['account.add', ['claude', 'console']], ['account.rename', ['work', '']]])
    expect(ran.map((command) => [command.type, command.project])).toEqual([['account.add', undefined], ['account.rename', undefined]])
    answers['account.remove'] = fail('config.unknownProject', { key: 'work' })
    const removing = remote.account.remove('work').catch((error: unknown) => error)
    expect(noticeOf(await removing).code).toBe('config.unknownProject')
  })

  it('serves every member of the page accounts control', () => {
    const control: AccountControl = machineServices().services.account
    for (const name of ['add', 'renew', 'switchTo', 'switchApp', 'remove', 'keep', 'code', 'cancel'] as const) expect(control[name]).toBeTypeOf('function')
  })

  it('reads a transcript and carries a file of it whole', async () => {
    const { remote, answers } = await started()
    answers['transcript.feed'] = { lines: [{ text: 'Done.' }], turn: null }
    answers['transcript.image'] = toCarried('image/png', new Uint8Array([137, 80, 78, 71]))
    expect(await remote.transcript.feed('session-1', 0)).toEqual({ lines: [{ text: 'Done.' }], turn: null })
    const image = await remote.transcript.image('session-1', 'tool-1', 0)
    expect(image?.type).toBe('image/png')
    expect([...fromCarried(image!)]).toEqual([137, 80, 78, 71])
    expect(await remote.transcript.sharedFile('session-1', 'tool-1', 3)).toBeUndefined()
  })

  it('puts the files of a reply only into a folder the machine agreed to', async () => {
    const { remote, answers, ran } = await started()
    answers['chat.saveInbox'] = [`${REPO}/.claude/worktrees/abc-1/.temp/inbox/note.txt`]
    const file = { name: 'note.txt', data: Buffer.from('Hello').toString('base64') }
    expect(await remote.chat.saveInbox(PROJECT, `${REPO}/.claude/worktrees/abc-1`, [file])).toHaveLength(1)
    expect(ran.at(-1)).toMatchObject({ type: 'chat.saveInbox', project: PROJECT, folder: `${REPO}/.claude/worktrees/abc-1` })
    const outside = remote.chat.saveInbox(PROJECT, 'C:/elsewhere', [file]).catch((error: unknown) => error)
    await tick()
    expect(noticeOf(await outside).code).toBe('machine.commandRefused')
  })

  it('hands the machine the records the hub keeps for it', async () => {
    const { remote, calls } = await started()
    const records: RetainedRecords = {
      launches: [{ at: '2026-11-16T10:00:00.000Z', project: PROJECT, task: 'ABC-1', sessionId: 'session-1' } as RetainedRecords['launches'][number]],
      windows: [['session-1', 200_000]],
      mail: [],
    }
    await remote.records.restore(records)
    expect(calls).toEqual([['records.restore', [records]]])
  })

  it('keeps the launches the machine made before the hub handed its journal, each once', async () => {
    const records = new MachineRecords(async () => {})
    const entry = (sessionId: string, at: string) => ({ at, project: PROJECT, task: 'ABC-1', sessionId })
    const kept = entry('session-1', '2026-11-16T10:00:00.000Z')
    const taken = entry('session-2', '2026-11-16T11:00:00.000Z')
    const fresh = entry('session-3', '2026-11-16T12:00:00.000Z')
    await records.launch(taken)
    await records.launch(fresh)
    records.restore([kept, taken])
    expect(records.journal).toEqual([kept, taken, fresh])
  })

  it('refuses a service the machine does not serve', async () => {
    const made = await bench()
    const booted = made.boot('first')
    stop.push(() => booted.end.stop(), () => made.hub.stop())
    await booted.end.start()
    await tick()
    const services: MachineServices = made.remote.services()
    const asked = services.transcript.note('session-1').catch((error: unknown) => error)
    await tick()
    expect(noticeOf(await asked).code).toBe('machine.commandFailed')
  })
})
