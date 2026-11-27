import { BOOT_WAIT_MS } from '../sessions/boot.js'
import type { SessionView } from '../state.js'

/**
 * A project's chat (BTN-1229, `docs/sessions/project-chats.md`): a session without a task that Even Keel starts from the
 * page in the project's checkout. Its account, model and effort are chosen at its creation and never change.
 */
export interface ChatRecord {
  /** Also the name its sessions start under (`chat-<hex>`): the session monitor finds them by it. */
  id: string
  project: string
  /** The agent of the chosen account (`src/agent/adapters.ts`). */
  agent: string
  /** The account folder the chat runs on. */
  account: string
  /** The model as the agent's CLI takes it; `null` — the agent's default. */
  model: string | null
  effort: string | null
  /** The title the CLI gave the session (`custom-title`, `ai-title`); `null` — none yet. */
  title: string | null
  /**
   * The name the user gave the chat in its window (BTN-1774), over `title`: the sweep rewrites `title` from the
   * transcript and never this. `null` — none, the title is the automatic one.
   */
  name: string | null
  /** The user's first message: the title until the CLI gives one. */
  first: string | null
  /** What the user wrote through Even Keel, newest last, for the archive's search; cut from the head at `SAID_CHARS`. */
  said: string
  /** The last message of the chat as last seen, kept for the archive. */
  last: ChatMessage | null
  /** The chat's session; `null` — no message sent yet, no process held. */
  sessionId: string | null
  /** The machine its session runs on, which every later call goes to; `null` — no session yet. */
  machine: string | null
  createdAt: string
  /** The last message or action of the chat: 24 hours later it goes to the archive. */
  lastAt: string
  /** When the user last opened the chat; `null` — never. */
  readAt: string | null
  archivedAt: string | null
  /** The chat that continued this one in a new session (BTN-1232). */
  successor: string | null
  /** The chat this one goes on from (BTN-1232). */
  previous: string | null
  /**
   * The first prompt of a chat that goes on from another (BTN-1232), kept until its session is launched: a restart of
   * the service in between launches it again with the same message. `null` — nothing waits.
   */
  pending: string | null
  /**
   * Its own choice of packages over the project's set (BTN-1696): `true` on, `false` off, a package not named — as the
   * project has it. Chosen at its creation, like the account.
   */
  packages: Record<string, boolean>
}

export type ChatSpeaker = 'user' | 'agent' | 'ask'

export interface ChatMessage {
  from: ChatSpeaker
  text: string
  at: string
}

/**
 * What the chat is doing, for the colour of its card: `new` — no message sent yet; `starting` — its session is being
 * launched; `working`; `waiting` — it waits for the user (a question, a permission); `answered` — its turn ended and its
 * cache is warm; `cold` — the cache went cold; `error` — a limit or an error ended its turn; `archived`.
 */
export type ChatState = 'new' | 'starting' | 'working' | 'waiting' | 'answered' | 'cold' | 'error' | 'archived'

/** A chat as the page lists it. */
export interface ChatCard {
  id: string
  project: string
  title: string | null
  agent: string
  account: string
  model: string | null
  /** The catalogue's name of `model`, when the session answers with it (`SessionView.modelTitle`). */
  modelTitle?: string
  effort: string | null
  state: ChatState
  /** The context fill in tokens and the model's window; `null` — unknown, no session yet. */
  context: { tokens: number; window: number | null } | null
  last: ChatMessage | null
  lastAt: string
  /** The last message is the agent's and the user has not opened the chat since. */
  unread: boolean
  sessionId: string | null
  archivedAt: string | null
  successor: string | null
  /** The chat this one goes on from: its window links it as "Continued from …" (BTN-1232). */
  previous: string | null
  /** The machine it runs on (BTN-1614); absent — an older service. */
  machine?: string
}

/** The last choice of a new chat in a project, offered first in the window of a new session. */
export interface ChatChoice {
  account: string
  model: string | null
  effort: string | null
  /** The chat's own choice of packages (`ChatRecord.packages`); absent — none of its own. */
  packages?: Record<string, boolean>
  /** The machine the chat went to (BTN-1710), offered first while it can take one; absent — a choice kept before. */
  machine?: string
}

/** Why a machine cannot take a new chat of the project: off the link, or no folder of the project there. */
export type ChatMachineBlock = 'offline' | 'noFolder'

/** A machine of the "New session" window (BTN-1614, query `chats/machines`). */
export interface ChatMachine {
  id: string
  name: string
  own: boolean
  block: ChatMachineBlock | null
  /**
   * Its account folders with the limits the hub has for them, as its panel shows them; `null` for the own machine,
   * whose accounts the page has live, and for one elsewhere not read since the hub started.
   */
  accounts: import('../account/model.js').AccountView | null
}

export interface ChatMachines {
  machines: ChatMachine[]
  /** The machine a chat goes to when the window names none; `null` — none can take it now. */
  picked: string | null
}

/** A page of the archive: `more` — an older page follows. No total count (BTN-1230). */
export interface ChatPage {
  chats: ChatCard[]
  more: boolean
}

export const CHAT_PREFIX = 'chat-'
/** A chat with no message nor action for this long goes to the archive, in any state (BTN-1230). */
export const ARCHIVE_AFTER_MS = 24 * 60 * 60 * 1000
export const ARCHIVE_PAGE = 20
/** The longest `said` kept: the archive's search reads the newest words. */
export const SAID_CHARS = 20_000
/** The longest message text a card keeps. */
export const LAST_CHARS = 1_000
/** The longest name the user gives a chat (BTN-1774). */
export const NAME_CHARS = 200
/** A turn ended with no cache window known is taken as cold after Claude's shortest cache. */
const COLD_AFTER_MS = 5 * 60 * 1000
/** States whose session works or waits for the user: never stopped to make room (BTN-1653). */
const BUSY: ReadonlySet<ChatState> = new Set(['starting', 'working', 'waiting'])

export interface LiveChat {
  id: string
  state: ChatState
  lastAt: string
}

/**
 * The live chats of a machine to stop so that one more fits under `ceiling` (BTN-1653): the idle ones, the longest idle
 * first; fewer, none at all, when the rest work or wait — the ceiling never holds a chat back.
 */
export function roomFor(live: readonly LiveChat[], ceiling: number): string[] {
  const over = live.length + 1 - ceiling
  if (over <= 0) return []
  return live
    .filter((chat) => !BUSY.has(chat.state))
    .sort((a, b) => Date.parse(a.lastAt) - Date.parse(b.lastAt))
    .slice(0, over)
    .map((chat) => chat.id)
}

export function isChatName(name: string | undefined): boolean {
  return name !== undefined && /^chat-[0-9a-f]{12}$/.test(name)
}

/** The session is a project chat's, as the monitor found it by its name: its hooks get the chat's mail (BTN-1346). */
export function isChatSession(views: readonly Pick<SessionView, 'task' | 'sessionId'>[], sessionId: string): boolean {
  return views.some((view) => view.sessionId === sessionId && isChatName(view.task))
}

/** The moment of the chat's last message or action: its record's, or later, its session's. */
export function lastAtOf(chat: Pick<ChatRecord, 'lastAt'>, view: Pick<SessionView, 'lastActivityAt'> | undefined): string {
  const seen = view?.lastActivityAt
  return seen != null && Date.parse(seen) > Date.parse(chat.lastAt) ? seen : chat.lastAt
}

export function archiveDue(lastAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(lastAt) >= ARCHIVE_AFTER_MS
}

type StateView = Pick<SessionView, 'lamp' | 'asking' | 'ask' | 'waitingFor' | 'startupDialog' | 'apiErrorKind' | 'cache' | 'lastActivityAt'>

export function stateOf(chat: Pick<ChatRecord, 'sessionId' | 'archivedAt' | 'last'>, view: StateView | undefined, starting: boolean, now: Date): ChatState {
  if (chat.archivedAt !== null) return 'archived'
  if (starting) return 'starting'
  if (chat.sessionId === null) return 'new'
  if (view === undefined) {
    // The launch can finish before the machine publishes its first session view.
    return chat.last?.from === 'user' && now.getTime() - Date.parse(chat.last.at) < BOOT_WAIT_MS ? 'starting' : 'cold'
  }
  if (view.asking || view.ask !== null || view.waitingFor !== null || view.startupDialog !== null) return 'waiting'
  if (view.lamp === 'working') return 'working'
  if (view.lamp === 'limit' || view.lamp === 'error') return 'error'
  if (view.apiErrorKind !== null && view.apiErrorKind !== 'transient') return 'error'
  if (view.cache !== null) return Date.parse(view.cache.until) > now.getTime() ? 'answered' : 'cold'
  const at = view.lastActivityAt
  return at !== null && now.getTime() - Date.parse(at) < COLD_AFTER_MS ? 'answered' : 'cold'
}

/** The session's last message from its recent lines: the user's words, the agent's text, or the question it asks. */
export function lastMessageOf(view: Pick<SessionView, 'feed' | 'ask' | 'lastActivityAt'> | undefined): ChatMessage | null {
  if (view === undefined) return null
  const question = view.ask?.questions[0]?.question
  if (question !== undefined) return { from: 'ask', text: cut(question), at: view.lastActivityAt ?? new Date(0).toISOString() }
  for (let index = view.feed.length - 1; index >= 0; index -= 1) {
    const line = view.feed[index]!
    if (line.text.trim() === '') continue
    if (line.kind === 'text') return { from: 'agent', text: cut(line.text), at: line.at }
    if (line.kind === 'prompt' || line.kind === 'answer') return { from: 'user', text: cut(line.text), at: line.at }
  }
  return null
}

export function cut(text: string, chars = LAST_CHARS): string {
  const trimmed = text.trim()
  return trimmed.length <= chars ? trimmed : `${trimmed.slice(0, chars - 1)}…`
}

/** `said` with the new words at the end, cut from the head. */
export function withSaid(said: string, text: string): string {
  const words = text.trim()
  if (words === '') return said
  const next = said === '' ? words : `${said}\n${words}`
  return next.length <= SAID_CHARS ? next : next.slice(next.length - SAID_CHARS)
}

export function unreadOf(last: ChatMessage | null, readAt: string | null): boolean {
  if (last === null || last.from === 'user') return false
  return readAt === null || Date.parse(last.at) > Date.parse(readAt)
}

/** The page's order of the active chats: those that wait for the user first, then by their last event, newest first. */
export function sortActive(cards: ChatCard[]): ChatCard[] {
  return [...cards].sort((a, b) => Number(b.state === 'waiting') - Number(a.state === 'waiting') || Date.parse(b.lastAt) - Date.parse(a.lastAt))
}

/** The kept title, unless it is the chat id a session wrote as its name before BTN-1339 passed it over. */
export function keptTitleOf(chat: ChatRecord): string | null {
  return chat.title === chat.id ? null : chat.title
}

export function cardOf(chat: ChatRecord, view: SessionView | undefined, starting: boolean, now: Date): ChatCard {
  const last = (chat.archivedAt === null ? lastMessageOf(view) : null) ?? chat.last
  return {
    id: chat.id,
    project: chat.project,
    title: chat.name ?? keptTitleOf(chat) ?? chat.first,
    agent: chat.agent,
    account: chat.account,
    model: chat.model,
    ...(view?.modelTitle !== undefined && view.model === chat.model ? { modelTitle: view.modelTitle } : {}),
    effort: chat.effort,
    state: stateOf(chat, view, starting || (chat.pending !== null && chat.sessionId === null), now),
    context: view === undefined ? null : { tokens: view.contextTokens, window: view.contextWindow },
    last,
    lastAt: lastAtOf(chat, view),
    unread: unreadOf(last, chat.readAt),
    sessionId: chat.sessionId,
    archivedAt: chat.archivedAt,
    successor: chat.successor,
    previous: chat.previous,
    ...(chat.machine !== null && { machine: chat.machine }),
  }
}
