import { describe, expect, it } from 'vitest'
import { splitUserMessage, USER_MESSAGE_HEAD } from '../chain/user-message.js'
import type { FeedLine } from '../sessions/transcript.js'
import { renewPrompt, RENEW_TURNS, turnsOf } from './prompt.js'

const at = '2026-11-18T10:00:00.000Z'
const line = (kind: FeedLine['kind'], text: string): FeedLine => ({ at, kind, text })

describe('the prompt of a chat going on in a new session (BTN-1232)', () => {
  it('takes the user\'s words and the agent\'s text, not the tools, the last ones only', () => {
    const recent = [
      line('prompt', 'Why is the build slow?'),
      line('tool', 'Read package.json'),
      line('text', 'The tests run twice.'),
      line('answer', 'And the lint?'),
      line('error', 'overloaded'),
      line('text', '  '),
    ]
    expect(turnsOf(recent)).toEqual([
      { from: 'user', text: 'Why is the build slow?' },
      { from: 'agent', text: 'The tests run twice.' },
      { from: 'user', text: 'And the lint?' },
    ])
    const many = Array.from({ length: RENEW_TURNS + 3 }, (_, index) => line('text', `step ${index}`))
    expect(turnsOf(many).map((turn) => turn.text)).toEqual(many.slice(3).map((each) => each.text))
  })

  it('keeps only the message of a prompt that carried an earlier chat on, and cuts a long turn to one line', () => {
    const carried = renewPrompt('Fix the header', null, 'en')
    const [turn] = turnsOf([line('prompt', carried)])
    expect(turn).toEqual({ from: 'user', text: 'Fix the header' })
    const [long] = turnsOf([line('text', `first\n\n${'x'.repeat(2_000)}`)])
    expect(long!.text.startsWith('first x')).toBe(true)
    expect(long!.text.length).toBeLessThan(700)
  })

  it('puts the turns and the transcript first and the user\'s message last, which the page splits off', () => {
    const prompt = renewPrompt('Fix the header\n', { sessionId: 's-1', transcript: 'C:\\claude\\projects\\s-1.jsonl', recent: [line('prompt', 'Hello'), line('text', 'Hi')] }, 'en')
    expect(prompt).toContain('- User: Hello\n- You: Hi')
    expect(prompt).toContain('C:\\claude\\projects\\s-1.jsonl')
    expect(prompt.endsWith(`${USER_MESSAGE_HEAD.en}\n\nFix the header\n`)).toBe(true)
    expect(splitUserMessage(prompt)?.message).toBe('Fix the header')
  })

  it('goes without the turns and the transcript when the machine knows none, in the project\'s language', () => {
    const prompt = renewPrompt('Поправь шапку', null, 'ru')
    expect(prompt).not.toContain('- ')
    expect(prompt.endsWith(`${USER_MESSAGE_HEAD.ru}\n\nПоправь шапку\n`)).toBe(true)
  })
})
