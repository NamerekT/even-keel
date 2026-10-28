import { once } from 'node:events'
import { rmSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { describe, expect, it, onTestFinished } from 'vitest'
import { serverFixture } from '../test/server.fixture.js'
import { Mailbox } from './sessions/mailbox.js'
import { mailFor, settleMail, type MailRelay } from './sessions/mailRelay.js'
import { Writes } from './storage/database.js'
import { memoryDatabase } from './storage/memory.js'

async function fixture() {
  const db = await memoryDatabase()
  const writes = new Writes(() => {})
  const now = () => new Date('2026-10-28T10:00:00Z')
  const mailbox = await Mailbox.open(db, writes, now)
  onTestFinished(() => writes.settled())
  const relay: MailRelay = {
    mailbox, now, language: () => 'en', changed: () => {}, log: () => {},
    live: () => ({ sessionId: 'session', midTurn: true, asking: false }),
    resume: async () => { throw new Error('mail was already reserved by a hook') },
  }
  mailbox.post('ABC-1', 'session', 'Read the attached picture.', ['C:/repo/.temp/inbox/picture.png'])
  const { server, base, publicDir, close } = await serverFixture({ mail: (id, event) => mailFor(relay, id, event) })
  onTestFinished(async () => {
    server.closeAllConnections()
    await close()
    rmSync(publicDir, { recursive: true, force: true })
  })
  const post = (signal?: AbortSignal) => fetch(`${base}/api/sessions/session/mail`, {
    method: 'POST', body: JSON.stringify({ event: 'PostToolUse' }), signal,
  })
  const blocked = Promise.withResolvers<{ response: ServerResponse; release: () => void }>()
  server.prependOnceListener('request', (_request, response) => {
    const end = response.end
    response.end = function (...args: Parameters<typeof end>) {
      blocked.resolve({ response, release: () => { Reflect.apply(end, response, args) } })
      return response
    } as typeof end
  })
  const reopened = async () => {
    await writes.settled()
    return Mailbox.open(db, writes, now)
  }
  return { post, mailbox, relay, blocked: blocked.promise, reopened }
}

describe('mail delivery over HTTP', { timeout: 30_000 }, () => {
  it('keeps mail waiting until the response finishes, then persists delivery', async () => {
    const { post, mailbox, relay, blocked, reopened } = await fixture()
    const result = post()
    void result.catch(() => {})
    const { response, release } = await blocked
    expect(mailbox.of('session')[0]).toMatchObject({ fate: 'waiting', event: null, settledAt: null })
    expect((await reopened()).of('session')[0]?.fate).toBe('waiting')
    expect(await (await post()).json()).toEqual({ message: null })
    relay.live = () => ({ sessionId: 'session', midTurn: false, asking: false })
    relay.now = () => new Date('2026-10-28T10:00:11Z')
    await settleMail(relay)
    const finished = once(response, 'finish')
    release()
    await finished
    expect(await (await result).json()).toMatchObject({ message: expect.stringContaining('picture.png') })
    expect(mailbox.of('session')[0]).toMatchObject({ fate: 'delivered', event: 'PostToolUse' })
    expect((await reopened()).of('session')[0]?.fate).toBe('delivered')
    expect(await (await post()).json()).toEqual({ message: null })
  })

  it('releases mail when the client aborts before the response, and delivers it on the next hook', async () => {
    const { post, mailbox, blocked, reopened } = await fixture()
    const controller = new AbortController()
    const result = post(controller.signal).catch((error: unknown) => error)
    const { response, release } = await blocked
    const closed = once(response, 'close')
    controller.abort()
    await result
    await closed
    release()
    expect(mailbox.of('session')[0]).toMatchObject({ fate: 'waiting', event: null, settledAt: null })
    expect(mailbox.waiting()).toHaveLength(1)
    expect((await reopened()).waiting()).toHaveLength(1)
    expect(await (await post()).json()).toMatchObject({ message: expect.stringContaining('picture.png') })
    expect(mailbox.of('session')[0]).toMatchObject({ fate: 'delivered', event: 'PostToolUse' })
  })
})
