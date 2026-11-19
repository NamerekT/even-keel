import { randomUUID } from 'node:crypto'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { Writes } from '../storage/database.js'
import { memoryDatabase } from '../storage/memory.js'
import { Inboxes, inboxPathOk, tellMail } from './inboxes.js'
import { mailIn } from './mail.js'
import { Mailbox } from './mailbox.js'

const SESSION = '11111111-2222-4333-8444-555555555555'
const TOKEN = 'a'.repeat(64)

const pipePath = () => (process.platform === 'win32' ? `\\\\.\\pipe\\even-keel-test-${randomUUID()}` : join(tmpdir(), `ek-${randomUUID().slice(0, 8)}.sock`))

/** A session's inbox as the CLI keeps it: lines of JSON; `silent` — it never reads, so a write never completes. */
async function inbox(silent = false): Promise<{ path: string; lines: () => Promise<unknown[]> }> {
  const path = pipePath()
  const received: string[] = []
  let done: () => void = () => {}
  const ended = new Promise<void>((resolve) => (done = resolve))
  const sockets: Socket[] = []
  const server: Server = createServer((socket) => {
    sockets.push(socket)
    socket.on('error', () => {})
    if (silent) return socket.pause()
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => received.push(chunk))
    socket.on('end', () => done())
  })
  await new Promise<void>((resolve) => server.listen(path, resolve))
  onTestFinished(() => {
    for (const socket of sockets) socket.destroy()
    return new Promise<void>((resolve) => server.close(() => resolve()))
  })
  return {
    path,
    lines: async () => {
      await ended
      return received.join('').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as unknown)
    },
  }
}

async function box() {
  const db = await memoryDatabase()
  const writes = new Writes((line) => {
    throw new Error(line)
  })
  // Runs before the database closes: hooks of a test finish last registered first.
  onTestFinished(() => writes.settled())
  return Mailbox.open(db, writes, () => new Date('2026-11-19T10:00:00.000Z'))
}

describe('Inboxes', { timeout: 30_000 }, () => {
  it('writes the auth line, then the message as the user message line', async () => {
    const { path, lines } = await inbox()
    const inboxes = new Inboxes()
    expect(inboxes.remember(SESSION, path, TOKEN)).toBe(true)
    expect(inboxes.knows(SESSION)).toBe(true)
    await inboxes.tell(SESSION, 'Use the other parser.')
    expect(await lines()).toEqual([
      { type: 'auth', token: TOKEN },
      { type: 'user', message: { role: 'user', content: 'Use the other parser.' } },
    ])
  })

  it('refuses an address that is no inbox socket, and knows nothing of it', () => {
    const inboxes = new Inboxes()
    expect(inboxes.remember(SESSION, 'C:\\Windows\\notepad.exe', TOKEN)).toBe(false)
    expect(inboxes.remember(SESSION, pipePath(), '')).toBe(false)
    expect(inboxes.knows(SESSION)).toBe(false)
    expect(inboxPathOk('\\\\.\\pipe\\LOCAL\\cc-msg-0123', 'win32')).toBe(true)
    expect(inboxPathOk('/tmp/cc-msg.sock', 'win32')).toBe(false)
    expect(inboxPathOk('/tmp/cc-msg.sock', 'linux')).toBe(true)
    expect(inboxPathOk('cc-msg.sock', 'linux')).toBe(false)
  })

  it('forgets a session whose inbox is gone: its process ended', async () => {
    const inboxes = new Inboxes()
    inboxes.remember(SESSION, pipePath(), TOKEN)
    await expect(inboxes.tell(SESSION, 'hello')).rejects.toThrow()
    expect(inboxes.knows(SESSION)).toBe(false)
  })

  it('gives up on an inbox that does not take the message in time', async () => {
    const { path } = await inbox(true)
    const inboxes = new Inboxes(50)
    inboxes.remember(SESSION, path, TOKEN)
    // Big enough to fill the pipe's buffer, so the write never completes against a reader that never reads.
    await expect(inboxes.tell(SESSION, 'x'.repeat(4 * 1024 * 1024))).rejects.toThrow(/in time/)
    expect(inboxes.knows(SESSION)).toBe(false)
  })

  it('keeps the newest sessions only', () => {
    const inboxes = new Inboxes(2000, 2)
    for (const id of ['a', 'b', 'c']) inboxes.remember(id, pipePath(), TOKEN)
    expect(['a', 'b', 'c'].map((id) => inboxes.knows(id))).toEqual([false, true, true])
  })
})

describe('tellMail', { timeout: 30_000 }, () => {
  it('delivers the message with its mark through the inbox and settles it at once', async () => {
    const { path, lines } = await inbox()
    const inboxes = new Inboxes()
    inboxes.remember(SESSION, path, TOKEN)
    const mailbox = await box()
    expect(await tellMail({ mailbox, inboxes, language: () => 'en' }, 'ABC-1', SESSION, 'Use the other parser.', ['C:\\repo\\.temp\\inbox\\a.png'])).toBe(true)
    const [, user] = (await lines()) as [unknown, { message: { content: string } }]
    expect(user.message.content).toMatch(/^This message is from the user, not from another session/)
    const [mark] = mailIn(user.message.content)
    expect(mark?.prompt).toContain('Use the other parser.')
    expect(mark?.prompt).toContain('C:\\repo\\.temp\\inbox\\a.png')
    expect(mailbox.of(SESSION).map((mail) => [mail.id, mail.fate, mail.event])).toEqual([[mark!.id, 'delivered', 'inbox']])
    expect(mailbox.waiting()).toEqual([])
  })

  it('leaves no trace for a session without an inbox or one that failed: the caller falls back', async () => {
    const inboxes = new Inboxes()
    const mailbox = await box()
    expect(await tellMail({ mailbox, inboxes, language: () => 'en' }, 'ABC-1', SESSION, 'hello', [])).toBe(false)
    inboxes.remember(SESSION, pipePath(), TOKEN)
    expect(await tellMail({ mailbox, inboxes, language: () => 'en' }, 'ABC-1', SESSION, 'hello', [])).toBe(false)
    expect(mailbox.of(SESSION)).toEqual([])
    expect(mailbox.waiting()).toEqual([])
  })
})
