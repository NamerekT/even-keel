/**
 * The machine's binding of the project chats' sessions to their chats (BTN-1772): a Claude chat starts without a name,
 * so the monitor knows its session by this. The machine binds what it launches and resumes; the hub hands back its
 * active chats' sessions at each connection (`RetainedRecords.chats`), as a restarted machine starts with none.
 * Nothing is unbound: a stopped chat's session stays its chat's, as one found by its name does.
 */
export class ChatSessions {
  private readonly chats = new Map<string, string>()

  bind(chat: string, sessionId: string): void {
    this.chats.set(sessionId, chat)
  }

  /** `[chat, sessionId]` pairs over the ones already bound. */
  restore(pairs: readonly (readonly [string, string])[]): void {
    for (const [chat, sessionId] of pairs) this.bind(chat, sessionId)
  }

  chatOf(sessionId: string): string | undefined {
    return this.chats.get(sessionId)
  }
}
