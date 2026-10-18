import { describe, expect, it, onTestFinished } from 'vitest'
import { Writes } from '../storage/database.js'
import { memoryDatabase } from '../storage/memory.js'
import { Mailbox } from './mailbox.js'
import { mailFor, settleMail, type MailRelay } from './mailRelay.js'

const SESSION = '11111111-2222-4333-8444-555555555555'
const OTHER = '66666666-7777-4888-8999-000000000000'

async function relay(live: { sessionId: string; midTurn: boolean; asking: boolean } | undefined, resume: MailRelay['resume'] = () => {}) {
  let now = Date.parse('2026-10-18T10:00:00.000Z')
  const writes = new Writes(() => {})
  const mailbox = await Mailbox.open(await memoryDatabase(), writes, () => new Date(now))
  // Runs before the database closes: hooks of a test finish last registered first.
  onTestFinished(() => writes.settled())
  const resumed: { task: string; sessionId: string; prompt: string }[] = []
  const log: string[] = []
  let changes = 0
  const deps: MailRelay = {
    mailbox,
    live: () => live,
    resume: (task, sessionId, prompt) => {
      resume(task, sessionId, prompt)
      resumed.push({ task, sessionId, prompt })
    },
    language: () => 'en',
    changed: () => changes++,
    log: (line) => log.push(line),
    now: () => new Date(now),
  }
  return { deps, mailbox, resumed, log, changes: () => changes, later: (seconds: number) => (now += seconds * 1000) }
}

// The first database of a file migrates the template, which under a full run takes longer than the default 5 s.
describe('settleMail', { timeout: 30_000 }, () => {
  it('leaves a message to the hooks while the session works', async () => {
    const { deps, mailbox, later, changes } = await relay({ sessionId: SESSION, midTurn: true, asking: false })
    mailbox.post('ABC-1', SESSION, 'one', [])
    later(60)
    settleMail(deps)
    expect(mailbox.waiting().map((mail) => mail.text)).toEqual(['one'])
    expect(changes()).toBe(0)
  })

  it('resumes a session that ended its turn without taking the messages, all of them in one prompt', async () => {
    const { deps, mailbox, later, resumed } = await relay({ sessionId: SESSION, midTurn: false, asking: false })
    mailbox.post('ABC-1', SESSION, 'one', [])
    mailbox.post('ABC-1', SESSION, 'two', [])
    later(11)
    settleMail(deps)
    expect(resumed).toHaveLength(1)
    expect(resumed[0]!.prompt).toContain('one')
    expect(resumed[0]!.prompt).toContain('two')
    expect(mailbox.of(SESSION).map((mail) => [mail.fate, mail.event])).toEqual([
      ['delivered', 'resume'],
      ['delivered', 'resume'],
    ])
  })

  it('gives the message back when the session asked a question meanwhile', async () => {
    const { deps, mailbox, later, resumed, changes } = await relay({ sessionId: SESSION, midTurn: false, asking: true })
    mailbox.post('ABC-1', SESSION, 'one', [])
    later(11)
    settleMail(deps)
    expect(resumed).toEqual([])
    expect(mailbox.of(SESSION).map((mail) => mail.fate)).toEqual(['returned'])
    expect(changes()).toBe(1)
  })

  it('gives the message back when the session is gone or another one took the task', async () => {
    const { deps, mailbox, later } = await relay({ sessionId: OTHER, midTurn: false, asking: false })
    mailbox.post('ABC-1', SESSION, 'one', [])
    later(11)
    settleMail(deps)
    expect(mailbox.of(SESSION).map((mail) => mail.fate)).toEqual(['returned'])
  })

  it('gives the message back when the resume is refused', async () => {
    const { deps, mailbox, later, log } = await relay({ sessionId: SESSION, midTurn: false, asking: false }, () => {
      throw new Error('limit')
    })
    mailbox.post('ABC-1', SESSION, 'one', [])
    later(11)
    settleMail(deps)
    expect(mailbox.of(SESSION).map((mail) => mail.fate)).toEqual(['returned'])
    expect(log.join('\n')).toContain('limit')
  })

  it('waits out the grace period after the post', async () => {
    const { deps, mailbox, later, resumed } = await relay({ sessionId: SESSION, midTurn: false, asking: false })
    mailbox.post('ABC-1', SESSION, 'one', [])
    later(5)
    settleMail(deps)
    expect(resumed).toEqual([])
    expect(mailbox.waiting()).toHaveLength(1)
  })
})

describe('mailFor', { timeout: 30_000 }, () => {
  it('gives the hook what waits, with the lead of its event, and nothing the second time', async () => {
    const { deps, mailbox, changes } = await relay({ sessionId: SESSION, midTurn: true, asking: false })
    const { id } = mailbox.post('ABC-1', SESSION, 'Use the other parser.', [])
    const message = mailFor(deps, SESSION, 'Stop')
    expect(message).toContain(`<even-keel-message id="${id}">`)
    expect(message).toContain('Use the other parser.')
    expect(changes()).toBe(1)
    expect(mailFor(deps, SESSION, 'PostToolUse')).toBeNull()
    expect(mailbox.listens(SESSION)).toBe(true)
  })
})
