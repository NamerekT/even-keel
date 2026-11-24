import { randomBytes } from 'node:crypto'
import type { Language } from '../language.js'
import type { MachineServices } from '../machine/services.js'
import { englishOf, fail, noticeOf } from '../notice/notice.js'
import { replyPrompt, type AskAnswers } from '../sessions/ask.js'
import type { InboxFile } from '../sessions/inbox.js'
import type { SessionView } from '../state.js'
import {
  archiveDue,
  CHAT_PREFIX,
  cardOf,
  cut,
  keptTitleOf,
  lastAtOf,
  lastMessageOf,
  sortActive,
  withSaid,
  type ChatCard,
  type ChatChoice,
  type ChatMachines,
  type ChatPage,
  type ChatRecord,
} from './model.js'
import type { ChatPlace } from './places.js'
import { renewPrompt, type ChatPast } from './prompt.js'
import type { ChatStore } from './store.js'

export type { ChatPlace } from './places.js'

export interface ProjectChatsDeps {
  store: ChatStore
  /**
   * The machine of a chat of the project and its folder there: `machine` when named, which must be able to take it,
   * else the own one, unless the project runs elsewhere only (`placeOf`, `src/chats/places.ts`); throws a notice.
   */
  placeOf: (project: string, machine?: string) => Promise<ChatPlace>
  /** The machines the "New session" window offers for the project (BTN-1614). */
  machines: (project: string) => Promise<ChatMachines>
  /** The commands to a machine connected now; `undefined` — off the link. */
  services: (machine: string) => Pick<MachineServices, 'chat' | 'chats'> | undefined
  /** The machine's sessions as the hub's mirror has them. */
  sessions: (machine: string) => SessionView[]
  /** The account folders of the machine with their agents; `undefined` — not read yet. */
  accounts: (machine: string) => Array<{ key: string; agent: string }> | undefined
  language: (project: string) => Language
  changed: () => void
  log: (line: string) => void
  now: () => Date
  newId?: () => string
}

export interface ChatMessageIn {
  text: string
  answers?: AskAnswers
  files: InboxFile[]
}

const newChatId = (): string => CHAT_PREFIX + randomBytes(6).toString('hex')

/**
 * The project chats on the hub (BTN-1230, `docs/sessions/project-chats.md`): the records, their sessions through the
 * machine of the project's folder, and the archive a day after a chat's last event.
 */
export class ProjectChats {
  /** The chats whose first session is being launched. */
  private readonly starting = new Set<string>()
  /** The chats going on in a new session now (`renew`). */
  private readonly moving = new Set<string>()

  constructor(private readonly deps: ProjectChatsDeps) {}

  /**
   * A new chat of the project with the choice, which becomes the project's offer for the next one; no session yet. It
   * runs on `machine` when the window named one (BTN-1614), else where `placeOf` puts it.
   */
  async create(project: string, choice: ChatChoice, named?: string): Promise<ChatCard> {
    const { machine } = await this.deps.placeOf(project, named)
    const account = this.deps.accounts(machine)?.find((each) => each.key === choice.account)
    if (account === undefined) throw fail('chats.noAccount', { account: choice.account })
    const chat = this.newRecord(project, account.agent, choice, machine, this.deps.now().toISOString())
    this.deps.store.setChoice(project, choice)
    this.deps.store.put(chat)
    this.deps.log(`chats: ${chat.id} of ${project} created on ${choice.account}`)
    this.deps.changed()
    return this.cardOf(chat)
  }

  /** The machines the "New session" window offers, with their accounts. */
  machines(project: string): Promise<ChatMachines> {
    return this.deps.machines(project)
  }

  choice(project: string): ChatChoice | null {
    return this.deps.store.choice(project)
  }

  /** The project's active chats, those that wait for the user first; of every project when none is named. */
  list(project?: string): ChatCard[] {
    return sortActive(this.deps.store.active(project).map((chat) => this.cardOf(chat)))
  }

  /** Page `page` of the project's archive, newest first, only the chats with `words` when given. */
  async archived(project: string, words: string, page: number): Promise<ChatPage> {
    const { chats, more } = await this.deps.store.archived(project, words, page)
    return { chats: chats.map((chat) => this.cardOf(chat)), more }
  }

  /** One chat, active or archived. */
  async card(id: string): Promise<ChatCard> {
    const chat = await this.deps.store.find(id)
    if (chat === undefined) throw fail('chats.unknown', {})
    return this.cardOf(chat)
  }

  /** The user's message: the chat's first one starts its session, a later one goes into it. */
  async send(id: string, message: ChatMessageIn): Promise<ChatCard> {
    const chat = await this.active(id)
    if (this.starting.has(id)) throw fail('chats.starting', {})
    const machine = chat.machine ?? (await this.deps.placeOf(chat.project)).machine
    const services = this.deps.services(machine)
    if (services === undefined) throw fail('chats.noMachine', {})
    const view = this.viewOf(chat)
    const folder = view?.cwd ?? (await this.deps.placeOf(chat.project, machine)).folder
    const files = await this.saveFiles(services, chat.project, folder, message.files)
    const prompt = replyPrompt({ from: 'page', answers: message.answers ?? {}, text: message.text, files }, view?.ask ?? null, this.deps.language(chat.project))
    let sessionId: string
    if (chat.sessionId === null) {
      this.starting.add(id)
      this.deps.changed()
      try {
        sessionId = await services.chats.launch(chat.project, folder, id, { account: chat.account, model: chat.model, effort: chat.effort, prompt })
      } finally {
        this.starting.delete(id)
      }
      this.deps.log(`chats: ${id} of ${chat.project} started the session ${sessionId}`)
    } else {
      sessionId = await services.chats.send(chat.project, id, { model: chat.model, effort: chat.effort, prompt })
      this.deps.log(`chats: ${id}: the user's message went to the session ${sessionId}${files.length > 0 ? ` with ${files.length} file(s)` : ''}`)
    }
    const at = this.deps.now().toISOString()
    const text = message.text.trim() === '' ? files.join('\n') : message.text
    const next: ChatRecord = {
      ...(this.deps.store.get(id) ?? chat),
      sessionId,
      machine,
      first: chat.first ?? cut(text),
      said: withSaid(chat.said, text),
      last: { from: 'user', text: cut(text), at },
      lastAt: at,
      readAt: at,
    }
    this.deps.store.put(next)
    this.deps.changed()
    return this.cardOf(next)
  }

  /**
   * The mailbox's resume (`MailRelay.resume`, BTN-1346): the chat's messages the session's hooks missed at the end of its
   * turn go into it as a later message does. The user's words are in the record already, from their `send`. `false` —
   * the chat is gone, archived or on another session now, or its machine is off the link.
   */
  async resume(id: string, sessionId: string, prompt: string): Promise<boolean> {
    const chat = this.deps.store.get(id)
    if (chat === undefined || chat.sessionId !== sessionId || chat.machine === null) return false
    const services = this.deps.services(chat.machine)
    if (services === undefined) return false
    await services.chats.send(chat.project, id, { model: chat.model, effort: chat.effort, prompt })
    this.deps.log(`chats: ${id}: the session ${sessionId} went on with the message its hooks missed at the end of its turn`)
    return true
  }

  /** The user opened the chat: what it said so far is read. */
  read(id: string): void {
    const chat = this.deps.store.get(id)
    if (chat === undefined) return
    this.deps.store.put({ ...chat, readAt: this.deps.now().toISOString() })
    this.deps.changed()
  }

  /**
   * Into the archive: its session is stopped (`docs/chain/exceptions.md`), its last message and title kept.
   * `successor` — the chat that goes on in a new session (BTN-1232). A stop that fails refuses the archive, unless
   * `anyway` (the archive a day after the last event): then it is a line in the log.
   */
  async archive(id: string, options: { successor?: string; anyway?: boolean } = {}): Promise<void> {
    const chat = await this.active(id)
    try {
      await this.stop(chat)
    } catch (error) {
      if (options.anyway !== true) throw error
      this.deps.log(`chats: ${id}: the session ${chat.sessionId} was not stopped on its way to the archive: ${messageOf(error)}`)
    }
    this.putArchived(chat, options.successor ?? null)
    this.deps.changed()
  }

  /**
   * "New session with this message" (BTN-1232): the chat goes on in a new chat with the choice, whose first prompt is the
   * old chat's last turns, its transcript and the message. The old session is stopped first: a stop that fails refuses
   * it and nothing changes. Then the new chat, its prompt pending, and the old one archived with it as the successor are
   * kept at once, and the new session launched; a restart in between launches it at the next sweep.
   */
  async renew(id: string, message: ChatMessageIn, choice: ChatChoice): Promise<ChatCard> {
    const old = await this.active(id)
    if (this.starting.has(id) || this.moving.has(id)) throw fail('chats.starting', {})
    this.moving.add(id)
    try {
      // The new session stays on the old one's machine: its transcript and `past` are there (BTN-1614).
      const place = await this.deps.placeOf(old.project, old.machine ?? undefined)
      const account = this.deps.accounts(place.machine)?.find((each) => each.key === choice.account)
      if (account === undefined) throw fail('chats.noAccount', { account: choice.account })
      const services = this.deps.services(place.machine)
      if (services === undefined) throw fail('chats.noMachine', {})
      const past = await this.pastOf(old)
      const files = await this.saveFiles(services, old.project, place.folder, message.files)
      const language = this.deps.language(old.project)
      const said = replyPrompt({ from: 'page', answers: message.answers ?? {}, text: message.text, files }, this.viewOf(old)?.ask ?? null, language)
      await this.stop(old)
      const at = this.deps.now().toISOString()
      const text = message.text.trim() === '' ? files.join('\n') : message.text
      const next: ChatRecord = {
        ...this.newRecord(old.project, account.agent, choice, place.machine, at),
        first: cut(text),
        said: withSaid('', text),
        last: { from: 'user', text: cut(text), at },
        previous: old.id,
        pending: renewPrompt(said, past, language),
      }
      this.deps.store.setChoice(old.project, choice)
      this.deps.store.put(next)
      this.putArchived(this.deps.store.get(id) ?? old, next.id)
      this.deps.log(`chats: ${id} goes on in ${next.id} on ${choice.account}`)
      return await this.launchPending(next, services, place.folder)
    } finally {
      this.moving.delete(id)
    }
  }

  /**
   * Once a minute: keeps what the sessions said (the last message, its time, the title the agent gave), launches what a
   * restart left pending and moves to the archive the chats whose last event is a day old.
   */
  async sweep(): Promise<void> {
    const now = this.deps.now()
    for (const chat of this.deps.store.active()) {
      if (this.starting.has(chat.id)) continue
      if (chat.pending !== null && chat.sessionId === null) {
        await this.relaunch(chat).catch((error: unknown) => this.deps.log(`chats: ${chat.id}: the pending session did not start: ${messageOf(error)}`))
        continue
      }
      const view = this.viewOf(chat)
      const lastAt = lastAtOf(chat, view)
      if (archiveDue(lastAt, now)) {
        await this.archive(chat.id, { anyway: true }).catch((error: unknown) => this.deps.log(`chats: ${chat.id} did not go to the archive: ${messageOf(error)}`))
        continue
      }
      const title = await this.titleOf(chat)
      const last = lastMessageOf(view) ?? chat.last
      if (title === chat.title && lastAt === chat.lastAt && JSON.stringify(last) === JSON.stringify(chat.last)) continue
      this.deps.store.put({ ...(this.deps.store.get(chat.id) ?? chat), title, last, lastAt })
      this.deps.changed()
    }
  }

  private newRecord(project: string, agent: string, choice: ChatChoice, machine: string, at: string): ChatRecord {
    return {
      id: (this.deps.newId ?? newChatId)(),
      project,
      agent,
      account: choice.account,
      model: choice.model,
      effort: choice.effort,
      title: null,
      first: null,
      said: '',
      last: null,
      sessionId: null,
      machine,
      createdAt: at,
      lastAt: at,
      readAt: at,
      archivedAt: null,
      successor: null,
      previous: null,
      pending: null,
    }
  }

  private async saveFiles(services: Pick<MachineServices, 'chat'>, project: string, folder: string, files: InboxFile[]): Promise<string[]> {
    if (files.length === 0) return []
    const carried = files.map((file) => ({ name: file.name, data: Buffer.from(file.data).toString('base64') }))
    try {
      return await services.chat.saveInbox(project, folder, carried)
    } catch (error) {
      throw fail('answer.file', { name: files.map((file) => file.name).join(', ') }, { detail: (error as Error).message }, { cause: error })
    }
  }

  /** Stops the chat's session through its machine, mid-turn too (`docs/chain/exceptions.md`); throws why it did not. */
  private async stop(chat: ChatRecord): Promise<void> {
    if (chat.sessionId === null || chat.machine === null) return
    const services = this.deps.services(chat.machine)
    if (services === undefined) throw fail('chats.noMachine', {})
    await services.chats.stop(chat.id)
  }

  private putArchived(chat: ChatRecord, successor: string | null): void {
    const view = this.viewOf(chat)
    const now = this.deps.now().toISOString()
    this.deps.store.put({ ...chat, last: lastMessageOf(view) ?? chat.last, lastAt: lastAtOf(chat, view), archivedAt: now, successor, pending: null })
    this.deps.log(`chats: ${chat.id} of ${chat.project} went to the archive${successor === null ? '' : `, continued by ${successor}`}`)
  }

  /** What the machine knows of the chat's session; `null` — none, or the machine did not answer. */
  private async pastOf(chat: ChatRecord): Promise<ChatPast | null> {
    if (chat.sessionId === null || chat.machine === null) return null
    try {
      return (await this.deps.services(chat.machine)?.chats.past(chat.id)) ?? null
    } catch (error) {
      this.deps.log(`chats: ${chat.id}: its last turns were not read: ${messageOf(error)}`)
      return null
    }
  }

  /** Launches the chat's pending prompt; a failed launch drops it, so the user writes again in the chat. */
  private async launchPending(chat: ChatRecord, services: Pick<MachineServices, 'chats'>, folder: string): Promise<ChatCard> {
    const prompt = chat.pending
    if (prompt === null) return this.cardOf(chat)
    this.starting.add(chat.id)
    this.deps.changed()
    let sessionId: string
    try {
      sessionId = await services.chats.launch(chat.project, folder, chat.id, { account: chat.account, model: chat.model, effort: chat.effort, prompt })
    } catch (error) {
      this.deps.store.put({ ...(this.deps.store.get(chat.id) ?? chat), pending: null })
      throw error
    } finally {
      this.starting.delete(chat.id)
      this.deps.changed()
    }
    const next: ChatRecord = { ...(this.deps.store.get(chat.id) ?? chat), sessionId, machine: chat.machine, pending: null }
    this.deps.store.put(next)
    this.deps.log(`chats: ${chat.id} of ${chat.project} started the session ${sessionId}`)
    return this.cardOf(next)
  }

  /**
   * A pending prompt a restart left: the session the machine already knows under the chat's name is taken, else it is
   * launched; a machine off the link keeps it for the next sweep.
   */
  private async relaunch(chat: ChatRecord): Promise<void> {
    if (chat.machine === null) return
    const services = this.deps.services(chat.machine)
    if (services === undefined) return
    const known = await services.chats.past(chat.id)
    if (known !== null) {
      this.deps.store.put({ ...chat, sessionId: known.sessionId, pending: null })
      this.deps.log(`chats: ${chat.id}: its pending session ${known.sessionId} had started before the restart`)
      this.deps.changed()
      return
    }
    const place = await this.deps.placeOf(chat.project, chat.machine)
    await this.launchPending(chat, services, place.folder)
  }

  private async titleOf(chat: ChatRecord): Promise<string | null> {
    const kept = keptTitleOf(chat)
    if (chat.sessionId === null || chat.machine === null) return kept
    try {
      return (await this.deps.services(chat.machine)?.chats.title(chat.account, chat.sessionId, chat.id)) ?? kept
    } catch {
      return kept
    }
  }

  private async active(id: string): Promise<ChatRecord> {
    const chat = this.deps.store.get(id)
    if (chat !== undefined) return chat
    const archived = await this.deps.store.find(id)
    throw fail(archived === undefined ? 'chats.unknown' : 'chats.archived', {})
  }

  private viewOf(chat: ChatRecord): SessionView | undefined {
    if (chat.sessionId === null || chat.machine === null) return undefined
    const views = this.deps.sessions(chat.machine).filter((view) => view.task === chat.id)
    return views.find((view) => view.sessionId === chat.sessionId) ?? views.at(-1)
  }

  private cardOf(chat: ChatRecord): ChatCard {
    return cardOf(chat, chat.archivedAt === null ? this.viewOf(chat) : undefined, this.starting.has(chat.id), this.deps.now())
  }
}

const messageOf = (error: unknown): string => englishOf(noticeOf(error))
