import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Gate, type Turn } from './agent.fixture.js'
import { ACCOUNT, Harness, PROJECT_ID } from './service.fixture.js'
import type { ChatCard } from '../chats/model.js'
import { scaled } from '../../test/slow-runner.js'

const HOUR = 60 * 60 * 1000

describe('idle project chats end to end', { timeout: scaled(60_000) }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
  })

  afterEach(async () => {
    await run.stop()
  })

  const callsOf = (id: string, kind: 'launch' | 'resume' | 'stop') => run.agent.calls.filter((call) => call.task === id && call.kind === kind)
  const create = () => run.answer<ChatCard>('chats/create', { project: PROJECT_ID, account: ACCOUNT })
  const send = (id: string, text: string) => run.answer<ChatCard>('chats/send', { id, text })
  const list = async () => (await run.answer<{ chats: ChatCard[] }>('chats/list', { project: PROJECT_ID })).chats
  const stateOf = async (id: string) => (await list()).find((chat) => chat.id === id)?.state
  /** A turn that writes a cache of an hour, as Claude's on a subscription does, and answers `say`. */
  const answered = (say: string): Turn => async (turn) => {
    turn.cache('1h')
    return { say }
  }
  /** Sends `text` to a fresh chat scripted with `turns` and waits for its answer. */
  const chatted = async (text: string, ...turns: Turn[]): Promise<string> => {
    const card = await create()
    run.agent.script(card.id, ...turns)
    await send(card.id, text)
    await run.until(() => callsOf(card.id, 'launch').length === 1, `the session of ${card.id} launched`)
    return card.id
  }

  it('stops the session of a chat whose cache went cold, keeps the chat and resumes the session with the next message', async () => {
    await run.start()
    const id = await chatted('What is in the backlog?', answered('Three tasks.'), answered('The first one.'))
    await run.until(() => run.service.sessions.some((view) => view.task === id && view.lamp !== 'finished'), 'the chat session seen')
    await run.pass(30 * 60 * 1000)
    expect(callsOf(id, 'stop')).toEqual([])

    await run.pass(HOUR)
    await run.until(() => callsOf(id, 'stop').length === 1, 'the cold chat session stopped')
    expect((await list()).map((chat) => chat.id)).toEqual([id])

    const sessionId = callsOf(id, 'launch')[0]!.sessionId
    await send(id, 'Which one goes first?')
    await run.until(() => callsOf(id, 'resume').length === 1, 'the chat session resumed')
    expect(callsOf(id, 'resume')[0]).toEqual(expect.objectContaining({ sessionId, prompt: expect.stringContaining('Which one goes first?') }))
    expect(callsOf(id, 'launch')).toHaveLength(1)
  })

  it('stops the longest idle chat session of the machine for a chat past the ceiling, never a working one', async () => {
    run.config.chatSessions = 3
    await run.start()
    const gate = new Gate()
    const working = await chatted('Look through the logs.', async (turn) => {
      await turn.park(gate)
      return { say: 'Nothing odd.' }
    })
    await run.pass(60_000)
    const oldest = await chatted('First question.', answered('First answer.'))
    await run.pass(60_000)
    const newer = await chatted('Second question.', answered('Second answer.'))
    await run.until(() => run.service.sessions.filter((view) => [working, oldest, newer].includes(view.task) && view.lamp !== 'finished').length === 3, 'three chat sessions seen')
    expect(await stateOf(working)).toBe('working')

    const fourth = await chatted('Third question.', answered('Third answer.'))
    expect(callsOf(oldest, 'stop')).toHaveLength(1)
    expect(callsOf(working, 'stop')).toEqual([])
    expect(callsOf(newer, 'stop')).toEqual([])
    expect((await list()).map((chat) => chat.id).sort()).toEqual([working, oldest, newer, fourth].sort())
    gate.open()
  })
})
