import { describe, expect, it } from 'vitest'
import { splitUserMessage, userMessageOf } from './user-message.js'

describe('userMessageOf', () => {
  it('gives the message of a message move without its head, in either language', () => {
    expect(userMessageOf('The user\'s message:\n\nCheck the logs too.\n')).toBe('Check the logs too.')
    expect(userMessageOf('Сообщение пользователя:\n\nПроверь логи.')).toBe('Проверь логи.')
  })

  it('is nothing for a reply of another move', () => {
    expect(userMessageOf(undefined)).toBeNull()
    expect(userMessageOf('Yes, keep it.')).toBeNull()
  })
})

describe('splitUserMessage', () => {
  it('splits the message off the end of a handoff prompt', () => {
    const prompt = 'ABC-1 Continue.\nLeft: run the tests.\n\nСообщение пользователя:\n\nCheck the logs too.\n'
    expect(splitUserMessage(prompt)).toEqual({ handoff: 'ABC-1 Continue.\nLeft: run the tests.', message: 'Check the logs too.' })
  })

  it('takes the last head, so a head quoted earlier in the handoff stays in it', () => {
    const prompt = 'ABC-1\nThe user\'s message:\n\nold\nLeft: x\nThe user\'s message:\n\nnew'
    expect(splitUserMessage(prompt)).toEqual({ handoff: 'ABC-1\nThe user\'s message:\n\nold\nLeft: x', message: 'new' })
  })

  it('is nothing for a prompt without a message', () => {
    expect(splitUserMessage('ABC-1 Continue the task.')).toBeNull()
    expect(splitUserMessage('ABC-1\nThe user\'s message:\n\n')).toBeNull()
  })
})
