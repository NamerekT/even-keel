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
  lastAtOf,
  lastMessageOf,
  sortActive,
  withSaid,
  type ChatCard,
  type ChatChoice,
  type ChatPage,
  type ChatRecord,
} from './model.js'
import type { ChatStore } from './store.js'

/** Where a project's folder is: its machine and the folder there. */
export interface ChatPlace {
  machine: string
  folder: string
}

export interface ProjectChatsDeps {
  store: ChatStore
  /** The machine of the project's folder (the own one, unless the project runs elsewhere only); throws a notice. */
  placeOf: (project: string) => Promise<ChatPlace>
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

  constructor(private readonly deps: ProjectChatsDeps) {}

  /** A new chat of the project with the choice, which becomes the project's offer for the next one; no session yet. */
  async create(project: string, choice: ChatChoice): Promise<ChatCard> {
    const { machine } = await this.deps.placeOf(project)
    const account = this.deps.accounts(machine)?.find((each) => each.key === choice.account)
    if (account === undefined) throw fail('chats.noAccount', { account: choice.account })
    const at = this.deps.now().toISOString()
    const chat: ChatRecord = {
      id: (this.deps.newId ?? newChatId)(),
      project,
      agent: account.agent,
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
    }
    this.deps.store.setChoice(project, choice)
    this.deps.store.put(chat)
    this.deps.log(`chats: ${chat.id} of ${project} created on ${choice.account}`)
    this.deps.changed()
    return this.cardOf(chat)
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
    const folder = view?.cwd ?? (await this.deps.placeOf(chat.project)).folder
    let files: string[] = []
    if (message.files.length > 0) {
      const carried = message.files.map((file) => ({ name: file.name, data: Buffer.from(file.data).toString('base64') }))
      try {
        files = await services.chat.saveInbox(chat.project, folder, carried)
      } catch (error) {
        throw fail('answer.file', { name: message.files.map((file) => file.name).join(', ') }, { detail: (error as Error).message }, { cause: error })
      }
    }
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
    if (chat.sessionId !== null && chat.machine !== null) {
      try {
        const services = this.deps.services(chat.machine)
        if (services === undefined) throw fail('chats.noMachine', {})
        await services.chats.stop(id)
      } catch (error) {
        if (options.anyway !== true) throw error
        this.deps.log(`chats: ${id}: the session ${chat.sessionId} was not stopped on its way to the archive: ${messageOf(error)}`)
      }
    }
    const view = this.viewOf(chat)
    const now = this.deps.now().toISOString()
    this.deps.store.put({ ...chat, last: lastMessageOf(view) ?? chat.last, lastAt: lastAtOf(chat, view), archivedAt: now, successor: options.successor ?? null })
    this.deps.log(`chats: ${id} of ${chat.project} went to the archive${options.successor === undefined ? '' : `, continued by ${options.successor}`}`)
    this.deps.changed()
  }

  /**
   * Once a minute: keeps what the sessions said (the last message, its time, the title the agent gave) and moves to the
   * archive the chats whose last event is a day old.
   */
  async sweep(): Promise<void> {
    const now = this.deps.now()
    for (const chat of this.deps.store.active()) {
      if (this.starting.has(chat.id)) continue
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

  private async titleOf(chat: ChatRecord): Promise<string | null> {
    if (chat.sessionId === null || chat.machine === null) return chat.title
    try {
      return (await this.deps.services(chat.machine)?.chats.title(chat.account, chat.sessionId)) ?? chat.title
    } catch {
      return chat.title
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
