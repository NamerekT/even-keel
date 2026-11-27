import { describe, expect, it } from 'vitest'
import { ChatSessions } from './chat-sessions.js'

describe('ChatSessions', () => {
  it("binds a chat's sessions, its first and its resumed copy, and takes the hub's pairs over its own", () => {
    const sessions = new ChatSessions()
    sessions.bind('chat-0123456789ab', 'first')
    sessions.bind('chat-0123456789ab', 'copy')
    sessions.restore([['chat-ba9876543210', 'other']])

    expect(['first', 'copy', 'other', 'hand'].map((id) => sessions.chatOf(id))).toEqual(['chat-0123456789ab', 'chat-0123456789ab', 'chat-ba9876543210', undefined])
  })
})
