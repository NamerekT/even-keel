import { describe, expect, it } from 'vitest'
import { Approvals } from './approvals.js'
import { replyPrompt, type Ask } from './ask.js'
import { NO_APPROVAL } from './permission.js'

const SESSION = 'session-1'
const PUBLISH = { command: 'npm publish', description: 'Publish the package' }

function approvals(unattended = false) {
  let now = 0
  const registry = new Approvals({ language: () => 'en', unattended: () => unattended, now: () => now })
  return { registry, wait: (ms: number) => (now += ms) }
}

const reply = (ask: Ask, answer: string | undefined, text = '') =>
  replyPrompt({ from: 'page', answers: answer === undefined ? {} : { [ask.questions[0]!.question]: answer }, text, files: [] }, ask, 'en')

describe('Approvals', () => {
  it('puts a call the hook asks about to the user as a question until it is answered', () => {
    const { registry } = approvals()
    expect(registry.poll(SESSION, 'Bash', PUBLISH, 0)).toBeNull()
    const ask = registry.ask(SESSION)!
    expect(ask.id).toMatch(/^perm:session-1:[0-9a-f]+$/)
    expect(ask.questions[0]).toMatchObject({ question: 'Allow the session to run Bash?' })
    expect(ask.questions[0]!.options[0]).toMatchObject({ label: 'Allow', preview: 'npm publish' })
    expect(registry.poll(SESSION, 'Bash', PUBLISH, 0)).toBeNull()
    expect(registry.ask(SESSION)?.id).toBe(ask.id)
    expect(registry.ask('session-2')).toBeNull()
  })

  it('hands the decision to the next poll of the same call, once', () => {
    const { registry } = approvals()
    registry.poll(SESSION, 'Bash', PUBLISH, 0)
    const ask = registry.ask(SESSION)!
    expect(registry.answer(SESSION, reply(ask, 'Allow'))).toEqual({ kind: 'allow', message: null })
    expect(registry.ask(SESSION)).toBeNull()
    expect(registry.poll(SESSION, 'Bash', PUBLISH, 0)).toEqual({ behavior: 'allow' })
    expect(registry.poll(SESSION, 'Bash', PUBLISH, 0)).toBeNull()
  })

  it('refuses the call on "Deny" or on words of the user own', () => {
    const { registry } = approvals()
    registry.poll(SESSION, 'Bash', PUBLISH, 0)
    registry.answer(SESSION, reply(registry.ask(SESSION)!, 'Deny'))
    expect(registry.poll(SESSION, 'Bash', PUBLISH, 0)).toEqual({ behavior: 'deny', message: 'The user denied this call: do without it.' })
    expect(registry.poll(SESSION, 'Bash', PUBLISH, 0)).toBeNull()
    const words = reply(registry.ask(SESSION)!, undefined, 'Publish from CI instead')
    registry.answer(SESSION, words)
    expect(registry.poll(SESSION, 'Bash', PUBLISH, 0)).toEqual({ behavior: 'deny', message: words.trim() })
  })

  it('answers the oldest of calls waiting together, then shows the next', () => {
    const { registry } = approvals()
    registry.poll(SESSION, 'Bash', PUBLISH, 0)
    registry.poll(SESSION, 'Edit', { file_path: 'a.ts' }, 0)
    registry.answer(SESSION, reply(registry.ask(SESSION)!, 'Allow'))
    expect(registry.ask(SESSION)?.questions[0]?.question).toBe('Allow the session to run Edit?')
    expect(registry.poll(SESSION, 'Edit', { file_path: 'a.ts' }, 0)).toBeNull()
    expect(registry.poll(SESSION, 'Bash', PUBLISH, 0)).toEqual({ behavior: 'allow' })
  })

  it('has no approval to answer when none waits', () => {
    const { registry } = approvals()
    expect(registry.answer(SESSION, 'go on')).toBeNull()
  })

  it('forgets a call its hook stopped asking about: the dialog was answered elsewhere or the hook ran out', () => {
    const { registry, wait } = approvals()
    registry.poll(SESSION, 'Bash', PUBLISH, 0)
    wait(9_000)
    expect(registry.ask(SESSION)).not.toBeNull()
    wait(2_000)
    expect(registry.ask(SESSION)).toBeNull()
    expect(registry.answer(SESSION, 'Allow')).toBeNull()
  })

  it('closes the calls of a session that no longer waits: their dialog was answered elsewhere, and their hooks go', () => {
    const { registry, wait } = approvals()
    registry.poll(SESSION, 'Bash', PUBLISH, 0)
    registry.settle(new Set())
    expect(registry.ask(SESSION)).not.toBeNull()
    wait(5_000)
    registry.poll(SESSION, 'Bash', PUBLISH, 0)
    wait(5_000)
    registry.poll(SESSION, 'Bash', PUBLISH, 0)
    registry.settle(new Set([SESSION]))
    expect(registry.ask(SESSION)).not.toBeNull()
    registry.settle(new Set())
    expect(registry.ask(SESSION)).toBeNull()
    expect(registry.poll(SESSION, 'Bash', PUBLISH, 0)).toBeUndefined()
    expect(registry.poll(SESSION, 'Bash', PUBLISH, 10_001)).toBeNull()
  })

  it('refuses at once while the chain runs unattended', () => {
    const { registry } = approvals(true)
    expect(registry.poll(SESSION, 'Bash', PUBLISH, 0)).toEqual({ behavior: 'deny', message: NO_APPROVAL })
    expect(registry.ask(SESSION)).toBeNull()
  })
})
