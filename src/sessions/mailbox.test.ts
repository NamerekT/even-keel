import { describe, expect, it, onTestFinished } from 'vitest'
import { Writes } from '../storage/database.js'
import { memoryDatabase } from '../storage/memory.js'
import { deliveredMail, mailIn, mailMessage } from './mail.js'
import { Mailbox, mailOutcome } from './mailbox.js'

const SESSION = '11111111-2222-4333-8444-555555555555'
const OTHER = '66666666-7777-4888-8999-000000000000'

async function box(start = Date.parse('2026-10-18T10:00:00.000Z')) {
  let now = start
  const db = await memoryDatabase()
  const writes = new Writes((line) => {
    throw new Error(line)
  })
  // Runs before the database closes: hooks of a test finish last registered first.
  onTestFinished(() => writes.settled())
  const mailbox = await Mailbox.open(db, writes, () => new Date(now))
  /** A new service on the same database, once what was written behind has landed. */
  const reopened = async () => {
    await writes.settled()
    return Mailbox.open(db, writes, () => new Date(now))
  }
  return { mailbox, reopened, later: (seconds: number) => (now += seconds * 1000) }
}

// The first database of a file migrates the template, which under a full run takes longer than the default 5 s.
describe('Mailbox', { timeout: 30_000 }, () => {
  it('keeps a message waiting until the session takes it, once', async () => {
    const { mailbox, later } = await box()
    const posted = mailbox.post('ABC-1', SESSION, 'Use the other parser.', ['C:\\repo\\.temp\\inbox\\a.png'])
    expect(posted).toMatchObject({ task: 'ABC-1', sessionId: SESSION, fate: 'waiting', event: null, files: ['C:\\repo\\.temp\\inbox\\a.png'] })
    expect(mailbox.take(OTHER)).toEqual([])
    later(5)
    const taken = mailbox.settle(mailbox.take(SESSION), 'delivered', 'PostToolUse')
    expect(taken.map((mail) => [mail.text, mail.fate, mail.event, mail.settledAt])).toEqual([['Use the other parser.', 'delivered', 'PostToolUse', '2026-10-18T10:00:05.000Z']])
    expect(mailbox.settle(mailbox.take(SESSION), 'delivered', 'Stop')).toEqual([])
  })

  it('outlives the service: a new mailbox on the same database sees what waits', async () => {
    const { mailbox, reopened } = await box()
    mailbox.post('ABC-1', SESSION, 'one', [])
    expect((await reopened()).waiting().map((mail) => mail.text)).toEqual(['one'])
  })

  it('reserves without persisting delivery and releases reservations after a restart or failed response', async () => {
    const { mailbox, reopened } = await box()
    mailbox.post('ABC-1', SESSION, 'one', [])
    const taken = mailbox.take(SESSION)
    expect(mailbox.waiting()).toEqual([])
    expect(mailbox.take(SESSION)).toEqual([])
    expect(mailbox.of(SESSION)[0]?.fate).toBe('waiting')
    expect((await reopened()).waiting().map((mail) => mail.text)).toEqual(['one'])
    mailbox.release(taken)
    expect(mailbox.take(SESSION).map((mail) => mail.text)).toEqual(['one'])
  })

  it('writes every change through to the database', async () => {
    const { mailbox, reopened, later } = await box()
    for (const text of ['a', 'b', 'c']) mailbox.post('ABC-1', SESSION, text, ['C:\\repo\\.temp\\inbox\\a.png'])
    mailbox.settle(mailbox.waiting().slice(0, 1), 'returned')
    mailbox.dismiss(SESSION)
    later(5)
    mailbox.settle(mailbox.take(SESSION), 'delivered', 'Stop')
    const again = await reopened()
    expect(again.of(SESSION)).toEqual(mailbox.of(SESSION))
    expect(again.of(SESSION).map((mail) => [mail.text, mail.fate, mail.event])).toEqual([
      ['b', 'delivered', 'Stop'],
      ['c', 'delivered', 'Stop'],
    ])
    expect(again.post('ABC-1', SESSION, 'd', []).id).toBe(4)
  })

  it('knows a session listens only once its hook asked', async () => {
    const { mailbox } = await box()
    expect(mailbox.listens(SESSION)).toBe(false)
    mailbox.take(SESSION)
    expect(mailbox.listens(SESSION)).toBe(true)
    expect(mailbox.listens(OTHER)).toBe(false)
  })

  it('settles only what still waits', async () => {
    const { mailbox } = await box()
    const first = mailbox.post('ABC-1', SESSION, 'one', [])
    const second = mailbox.post('ABC-1', SESSION, 'two', [])
    mailbox.settle(mailbox.take(SESSION), 'delivered', 'Stop')
    const third = mailbox.post('ABC-1', SESSION, 'three', [])
    expect(mailbox.settle([first, second, third], 'returned').map((mail) => mail.text)).toEqual(['three'])
    expect(mailbox.of(SESSION).map((mail) => [mail.text, mail.fate])).toEqual([
      ['one', 'delivered'],
      ['two', 'delivered'],
      ['three', 'returned'],
    ])
  })

  it('shows a session its waiting and returned messages and the last delivered ones; a dismissed one goes', async () => {
    const { mailbox } = await box()
    for (const text of ['a', 'b', 'c', 'd']) {
      mailbox.post('ABC-1', SESSION, text, [])
      mailbox.settle(mailbox.take(SESSION), 'delivered', 'PostToolUse')
    }
    const returned = mailbox.post('ABC-1', SESSION, 'back', [])
    mailbox.settle([returned], 'returned')
    mailbox.post('ABC-1', SESSION, 'new', [])
    expect(mailbox.of(SESSION).map((mail) => mail.text)).toEqual(['b', 'c', 'd', 'back', 'new'])
    mailbox.dismiss(SESSION)
    expect(mailbox.of(SESSION).map((mail) => mail.text)).toEqual(['b', 'c', 'd', 'new'])
    expect(mailbox.delivered(SESSION).map((mail) => mail.text)).toEqual(['a', 'b', 'c', 'd'])
    expect(mailbox.delivered(OTHER)).toEqual([])
  })

  it('forgets settled messages after a week', async () => {
    const { mailbox, reopened, later } = await box()
    mailbox.post('ABC-1', SESSION, 'old', [])
    mailbox.settle(mailbox.take(SESSION), 'delivered', 'Stop')
    mailbox.post('ABC-1', SESSION, 'still waiting', [])
    later(8 * 24 * 60 * 60)
    mailbox.post('ABC-1', SESSION, 'fresh', [])
    expect(mailbox.of(SESSION).map((mail) => mail.text)).toEqual(['still waiting', 'fresh'])
    expect((await reopened()).of(SESSION).map((mail) => mail.text)).toEqual(['still waiting', 'fresh'])
  })
})

describe('mailOutcome', () => {
  const posted = '2026-10-18T10:00:00.000Z'
  const at = (seconds: number) => new Date(Date.parse(posted) + seconds * 1000)

  it('leaves the message to the hooks while the session works', () => {
    expect(mailOutcome(posted, { midTurn: true, asking: false }, at(600))).toBe('wait')
  })

  it('gives the hooks a moment after the post before judging a session that looks idle', () => {
    expect(mailOutcome(posted, { midTurn: false, asking: false }, at(3))).toBe('wait')
  })

  it('resumes a session that ended its turn without a question, and returns one that asks', () => {
    expect(mailOutcome(posted, { midTurn: false, asking: false }, at(30))).toBe('resume')
    expect(mailOutcome(posted, { midTurn: false, asking: true }, at(30))).toBe('return')
  })

  it('returns a message whose session is gone', () => {
    expect(mailOutcome(posted, undefined, at(30))).toBe('return')
  })
})

describe('mailMessage and mailIn', () => {
  const mail = (id: number, text: string, files: string[] = []) => ({
    id,
    task: 'ABC-1',
    sessionId: SESSION,
    text,
    files,
    postedAt: '2026-10-18T10:00:00.000Z',
    fate: 'delivered' as const,
    event: 'PostToolUse' as const,
    settledAt: '2026-10-18T10:00:05.000Z',
  })

  it('wraps each message for the session and reads it back', () => {
    const message = mailMessage([mail(3, 'Use the other parser.'), mail(4, '', ['C:\\repo\\.temp\\inbox\\a.png'])], 'PostToolUse', 'en')
    expect(message).toMatch(/^The user wrote to you from Even Keel's chat/)
    expect(mailIn(message)).toEqual([
      { id: 3, prompt: 'Use the other parser.\n' },
      { id: 4, prompt: 'Files from the user:\n- C:\\repo\\.temp\\inbox\\a.png\n' },
    ])
  })

  it('tells a session why its question did not go out', () => {
    expect(mailMessage([mail(1, 'Stop.')], 'AskUserQuestion', 'en')).toMatch(/^Your question did not go out/)
    expect(mailMessage([mail(1, 'Стоп.')], 'Stop', 'ru')).toMatch(/^Пользователь написал тебе/)
  })

  it.each(['en', 'ru'] as const)('asks for the same final mark after Stop mail in %s', (language) => {
    const message = mailMessage([mail(1, 'Reply PONG.')], 'Stop', language)
    for (const mark of ['NO CHANGES:', 'CHECKPOINT:', 'PULL REQUEST:']) expect(message).toContain(mark)
    expect(message).toContain(language === 'en' ? 'repeat that same line as the last line' : 'повтори ту же строку последней строкой')
    expect(mailMessage([mail(1, 'Reply PONG.')], 'PostToolUse', language)).not.toContain('NO CHANGES:')
  })

  it('hands a fold only the messages a hook delivered, at the time it took them, as the session got them', () => {
    const delivered = { ...mail(5, 'Use the other parser.', ['C:\\repo\\.temp\\inbox\\a.png']), reason: null }
    const others = [
      { ...delivered, id: 6, event: 'resume' as const },
      { ...delivered, id: 7, fate: 'waiting' as const, event: null, settledAt: null },
      { ...delivered, id: 8, fate: 'returned' as const, event: null, reason: 'asked' as const },
    ]
    expect(deliveredMail([delivered, ...others], 'en')).toEqual([{ id: 5, at: '2026-10-18T10:00:05.000Z', prompt: mailIn(mailMessage([delivered], 'PostToolUse', 'en'))[0]!.prompt }])
  })

  it('finds nothing in a text that only names the mark', () => {
    expect(mailIn('<even-keel-message id="${mail.id}">\nx\n</even-keel-message>')).toEqual([])
    expect(mailIn('plain text')).toEqual([])
  })
})
