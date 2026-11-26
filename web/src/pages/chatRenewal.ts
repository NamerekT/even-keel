import type { AccountEntry } from '../../../src/account/model.js'
import type { ChatCard, ChatChoice } from '../../../src/chats/model.js'
import type { LimitSpan } from '../../../src/limits/model.js'
import type { SessionView } from '../../../src/state.js'
import { tightestWindow } from '../accounts.js'
import { coldReply } from './coldReply.js'

/**
 * Why a message to a project chat asks first whether to go on in a new session (BTN-1232): its cache went cold — when
 * and how much a reply rereads —, or its account is at a limit — which window and when it resets, when known.
 */
export type ChatRenewal =
  | { kind: 'cold'; since: string; tokens: number }
  | { kind: 'limit'; span: LimitSpan | null; resetsAt: string | null }

/** Whether the account can start a chat now: not waiting for a sign-in, no window spent. */
export function accountOpen(entry: AccountEntry): boolean {
  return !entry.needsLogin && tightestWindow(entry.limits)?.free !== 0
}

/**
 * The renewal a message to the chat offers; `null` — it goes as usual. A chat with no session or at work never asks; a
 * spent account wins over a cold cache. Without the session's view the chat's own state stands for its cache.
 */
export function chatRenewal(chat: ChatCard, session: SessionView | undefined, entry: AccountEntry | undefined, now: Date): ChatRenewal | null {
  if (chat.sessionId === null || chat.archivedAt !== null || chat.state === 'working' || chat.state === 'starting') return null
  if (session?.lamp === 'working') return null
  const tightest = entry === undefined ? null : tightestWindow(entry.limits)
  if (tightest !== null && tightest.free === 0) return { kind: 'limit', span: tightest.span, resetsAt: tightest.window.resetsAt }
  if (session?.lamp === 'limit') return { kind: 'limit', span: null, resetsAt: null }
  if (session !== undefined) {
    const cold = coldReply(session, now)
    return cold === null ? null : { kind: 'cold', ...cold }
  }
  return chat.state === 'cold' ? { kind: 'cold', since: chat.lastAt, tokens: chat.context?.tokens ?? 0 } : null
}

/**
 * The choice the window offers first: the project's last one; at a limit the next account with room — the last choice
 * when it is another open account, else an open one of the chat's agent, else any open one. The model and the effort
 * stay only on an account of the same agent as where they come from. The machine is the chat's, never the last
 * choice's (BTN-1711): the user moves it to another by hand.
 */
export function renewalChoice(chat: ChatCard, renewal: ChatRenewal, last: ChatChoice | null, accounts: AccountEntry[]): ChatChoice {
  const { machine: _last, ...choice } = accountChoice(chat, renewal, last, accounts)
  return chat.machine === undefined ? choice : { ...choice, machine: chat.machine }
}

function accountChoice(chat: ChatCard, renewal: ChatRenewal, last: ChatChoice | null, accounts: AccountEntry[]): ChatChoice {
  const open = accounts.filter(accountOpen)
  const of = (key: string | undefined) => accounts.find((entry) => entry.key === key)
  const fromChat: ChatChoice = { account: chat.account, model: chat.model, effort: chat.effort }
  const base = last ?? fromChat
  if (renewal.kind === 'cold') return of(base.account) === undefined ? fromChat : base
  const lastOpen = open.find((entry) => entry.key === last?.account && entry.key !== chat.account)
  const picked = lastOpen ?? open.find((entry) => entry.agent === chat.agent && entry.key !== chat.account) ?? open.find((entry) => entry.key !== chat.account)
  if (picked === undefined) return fromChat
  const source = lastOpen !== undefined ? base : fromChat
  return of(source.account)?.agent === picked.agent ? { ...source, account: picked.key } : { account: picked.key, model: null, effort: source.effort }
}
