import { randomBytes } from 'node:crypto'
import type { Language } from '../language.js'
import { TRANSCRIPT_PART_BYTES, type ChatStart, type MachineServices } from '../machine/services.js'
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
  NAME_CHARS,
  roomFor,
  sortActive,
  stateOf,
  withSaid,
  type ChatCard,
  type ChatChoice,
  type ChatMachines,
  type ChatPage,
  type ChatRecord,
} from './model.js'
import type { ChatPlace } from './places.js'
import { handoverOf, renewPrompt, withHandover, type ChatPast } from './prompt.js'
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
  /** The machine's name as the page shows it, for a prompt that says where a transcript stayed. */
  machineName: (machine: string) => string
  /** The account folders of the machine with their agents; `undefined` — not read yet. */
  accounts: (machine: string) => Array<{ key: string; agent: string }> | undefined
  language: (project: string) => Language
  changed: () => void
  log: (line: string) => void
  now: () => Date
  newId?: () => string
  /** The `chatSessions` setting, read at each launch: live chat sessions a machine keeps (BTN-1653). */
  ceiling: () => number
}

export interface ChatMessageIn {
  text: string
  answers?: AskAnswers
  files: InboxFile[]
}

/** The machine, folder, commands and agent of the account a chat goes on at (`renew`, `continueEarly`). */
interface ChatTarget {
  place: ChatPlace
  services: Pick<MachineServices, 'chat' | 'chats'>
  agent: string
}

const newChatId = (): string => CHAT_PREFIX + randomBytes(6).toString('hex')

/** The largest transcript carried to another machine (BTN-1711), as a message's files may be. */
export const TRANSCRIPT_COPY_BYTES = 64 * 1024 * 1024

/** The whole choice a call to the machine carries: it keeps nothing of a chat. */
const startOf = (chat: ChatRecord, prompt: string): Omit<ChatStart, 'account'> => ({
  model: chat.model,
  effort: chat.effort,
  prompt,
  ...(Object.keys(chat.packages).length > 0 && { packages: chat.packages }),
})
/** How long a session stopped as idle counts as stopped while the machine's view of it may still say it lives. */
const STOP_SEEN_MS = 2 * 60 * 1000

/**
 * The project chats on the hub (BTN-1230, `docs/sessions/project-chats.md`): the records, their sessions through the
 * machine of the project's folder, and the archive a day after a chat's last event.
 */
export class ProjectChats {
  /** The chats whose first session is being launched. */
  private readonly starting = new Set<string>()
  /** The chats going on in a new session now (`renew`). */
  private readonly moving = new Set<string>()
  /** The chats whose session was stopped as idle (BTN-1653), with the time of the stop. */
  private readonly idled = new Map<string, number>()

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
    this.deps.store.setChoice(project, { ...choice, machine })
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

  /** A chat's own choice of packages over its project's set (BTN-1696), for its `/` menu (BTN-1716). */
  async packagesOf(id: string): Promise<Record<string, boolean>> {
    const chat = await this.deps.store.find(id)
    if (chat === undefined) throw fail('chats.unknown', {})
    return chat.packages
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
    const language = this.deps.language(chat.project)
    const said = replyPrompt({ from: 'page', answers: message.answers ?? {}, text: message.text, files }, view?.ask ?? null, language)
    // A chat continued early sends the old one's hand-over with its first message (BTN-1776).
    const prompt = chat.sessionId === null && chat.handover !== null ? withHandover(chat.handover, said, language) : said
    if (!this.running(chat)) await this.makeRoom(chat, machine)
    this.idled.delete(id)
    let sessionId: string
    if (chat.sessionId === null) {
      this.starting.add(id)
      this.deps.changed()
      try {
        sessionId = await services.chats.launch(chat.project, folder, id, { account: chat.account, ...startOf(chat, prompt) })
      } finally {
        this.starting.delete(id)
      }
      this.deps.log(`chats: ${id} of ${chat.project} started the session ${sessionId}`)
    } else {
      sessionId = await services.chats.send(chat.project, id, startOf(chat, prompt))
      this.deps.log(`chats: ${id}: the user's message went to the session ${sessionId}${files.length > 0 ? ` with ${files.length} file(s)` : ''}`)
    }
    const at = this.deps.now().toISOString()
    const text = message.text.trim() === '' ? files.join('\n') : message.text
    const next: ChatRecord = {
      ...(this.deps.store.get(id) ?? chat),
      sessionId,
      machine,
      handover: null,
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
    await services.chats.send(chat.project, id, startOf(chat, prompt))
    this.deps.log(`chats: ${id}: the session ${sessionId} went on with the message its hooks missed at the end of its turn`)
    return true
  }

  /**
   * The user's name of the chat from its window's head (BTN-1774), active or archived; an empty one brings back the
   * automatic title. Kept by Even Keel only: nothing goes to the session.
   */
  async rename(id: string, name: string): Promise<ChatCard> {
    const chat = await this.deps.store.find(id)
    if (chat === undefined) throw fail('chats.unknown', {})
    const next: ChatRecord = { ...chat, name: name.trim() === '' ? null : cut(name, NAME_CHARS) }
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
   * `anyway` (the archive a day after the last event): then it is a line in the log. A launch under way refuses it
   * (`chats.starting`): its end would keep the chat active again.
   */
  async archive(id: string, options: { successor?: string; anyway?: boolean } = {}): Promise<void> {
    const chat = await this.active(id)
    if (options.anyway !== true && (this.starting.has(id) || this.moving.has(id))) throw fail('chats.starting', {})
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
   * Deletes an empty chat for good (BTN-1775): one with no session, none being launched, none pending and no hand-over
   * waiting (BTN-1776), so nothing of it runs or is kept anywhere but its record. Any other goes to the archive instead.
   */
  async remove(id: string): Promise<void> {
    const chat = await this.active(id)
    if (chat.sessionId !== null || chat.pending !== null || chat.handover !== null || this.starting.has(id) || this.moving.has(id)) throw fail('chats.hasSession', {})
    this.deps.store.remove(id)
    this.deps.log(`chats: ${id} of ${chat.project} deleted, it had no session`)
    this.deps.changed()
  }

  /**
   * "New session with this message" (BTN-1232): the chat goes on in a new chat with the choice, whose first prompt is the
   * old chat's last turns, its transcript and the message. The old session is stopped first: a stop that fails refuses
   * it and nothing changes. Then the new chat, its prompt pending, and the old one archived with it as the successor are
   * kept at once, and the new session launched; a restart in between launches it at the next sweep.
   * It goes on at `named` when the window named a machine (BTN-1711), else at the old chat's. At another machine the old
   * transcript is carried into the new one's folder (`carryTranscript`); with the old machine off the link there is
   * nothing to stop, read or carry there, and the prompt says where the transcript stayed.
   */
  async renew(id: string, message: ChatMessageIn, asked: ChatChoice, named?: string): Promise<ChatCard> {
    const old = await this.active(id)
    // The renewal window picks no packages: the new chat keeps the old one's own choice (BTN-1696).
    const choice: ChatChoice = asked.packages !== undefined || Object.keys(old.packages).length === 0 ? asked : { ...asked, packages: old.packages }
    if (this.starting.has(id) || this.moving.has(id)) throw fail('chats.starting', {})
    this.moving.add(id)
    try {
      const target = await this.targetOf(old, choice, named)
      const { place, services } = target
      const past = await this.pastOf(old)
      const files = await this.saveFiles(services, old.project, place.folder, message.files)
      const language = this.deps.language(old.project)
      const said = replyPrompt({ from: 'page', answers: message.answers ?? {}, text: message.text, files }, this.viewOf(old)?.ask ?? null, language)
      const { carried, stayedOn } = await this.release(old, target, past)
      const at = this.deps.now().toISOString()
      const text = message.text.trim() === '' ? files.join('\n') : message.text
      const next: ChatRecord = {
        ...this.newRecord(old.project, target.agent, choice, place.machine, at),
        name: old.name,
        first: cut(text),
        said: withSaid('', text),
        last: { from: 'user', text: cut(text), at },
        previous: old.id,
        pending: renewPrompt(said, carried, language, stayedOn),
      }
      this.passOn(old, next, choice)
      return await this.launchPending(next, services, place.folder)
    } finally {
      this.moving.delete(id)
    }
  }

  /**
   * "Continue in new session…" of the chat's ⋯ menu (BTN-1776): `renew` ahead of a cold cache or a limit and without a
   * message. The old session is stopped and the old chat archived with the new one as its successor at once, a
   * transcript carried to another machine at once too, while the old one is on the link; the new chat keeps the
   * hand-over (`handoverOf`) and launches nothing until the user's first message, which `send` sends with it.
   */
  async continueEarly(id: string, asked: ChatChoice, named?: string): Promise<ChatCard> {
    const old = await this.active(id)
    if (old.sessionId === null) throw fail('chats.noSession', {})
    const choice: ChatChoice = asked.packages !== undefined || Object.keys(old.packages).length === 0 ? asked : { ...asked, packages: old.packages }
    if (this.starting.has(id) || this.moving.has(id)) throw fail('chats.starting', {})
    this.moving.add(id)
    try {
      const target = await this.targetOf(old, choice, named)
      const past = await this.pastOf(old)
      const { carried, stayedOn } = await this.release(old, target, past)
      const next: ChatRecord = {
        ...this.newRecord(old.project, target.agent, choice, target.place.machine, this.deps.now().toISOString()),
        name: old.name,
        previous: old.id,
        handover: handoverOf(carried, this.deps.language(old.project), stayedOn),
      }
      this.passOn(old, next, choice)
      this.deps.changed()
      return this.cardOf(next)
    } finally {
      this.moving.delete(id)
    }
  }

  /** Where a chat goes on (BTN-1711): `named` when the window named a machine, else the old chat's; throws a notice. */
  private async targetOf(old: ChatRecord, choice: ChatChoice, named?: string): Promise<ChatTarget> {
    const place = await this.deps.placeOf(old.project, named ?? old.machine ?? undefined)
    const account = this.deps.accounts(place.machine)?.find((each) => each.key === choice.account)
    if (account === undefined) throw fail('chats.noAccount', { account: choice.account })
    const services = this.deps.services(place.machine)
    if (services === undefined) throw fail('chats.noMachine', {})
    return { place, services, agent: account.agent }
  }

  /**
   * Stops the old session (exception 12) and, at another machine, carries its transcript there; the past the new chat's
   * prompt tells and the machine it stayed on. With the old machine off the link nothing is stopped or carried.
   */
  private async release(old: ChatRecord, { place, services }: ChatTarget, past: ChatPast | null): Promise<{ carried: ChatPast | null; stayedOn?: string }> {
    const from = old.machine !== null && old.machine !== place.machine ? old.machine : null
    const gone = from !== null && this.deps.services(from) === undefined
    if (gone) this.deps.log(`chats: ${old.id}: the session ${old.sessionId} was not stopped: its machine ${from} is off the link`)
    else await this.stop(old)
    if (from === null || old.sessionId === null) return { carried: past }
    // The old session is stopped by now: its transcript is whole.
    const copy = gone ? null : await this.carryTranscript(old, from, services, place.folder)
    const carried = { sessionId: old.sessionId, recent: past?.recent ?? [], transcript: copy }
    return copy === null ? { carried, stayedOn: this.deps.machineName(from) } : { carried }
  }

  /** Keeps the new chat, makes its choice the project's last one and archives the old chat with it as the successor. */
  private passOn(old: ChatRecord, next: ChatRecord, choice: ChatChoice): void {
    this.deps.store.setChoice(old.project, { ...choice, machine: next.machine ?? undefined })
    this.deps.store.put(next)
    this.putArchived(this.deps.store.get(old.id) ?? old, next.id)
    this.deps.log(`chats: ${old.id} goes on in ${next.id} on ${choice.account}`)
  }

  /**
   * Once a minute: keeps what the sessions said (the last message, its time, the title the agent gave), launches what a
   * restart left pending, stops the live sessions whose cache went cold (BTN-1653) and moves to the archive the chats
   * whose last event is a day old.
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
      if (!this.moving.has(chat.id) && this.running(chat) && stateOf(chat, view, false, now) === 'cold') await this.stopIdle(chat, 'its cache went cold')
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
      name: null,
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
      handover: null,
      packages: choice.packages ?? {},
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

  /**
   * The old chat's transcript, read from its machine `from` part by part, saved into `.temp/inbox/` of `folder` at the
   * machine the chat goes on at (BTN-1711); the copy's path there. `null` — none known (BTN-1739), over
   * `TRANSCRIPT_COPY_BYTES`, or a read or a save failed: a line in the log, and the prompt says it stayed on `from`.
   */
  private async carryTranscript(old: ChatRecord, from: string, to: Pick<MachineServices, 'chat'>, folder: string): Promise<string | null> {
    const reader = this.deps.services(from)
    if (reader === undefined) return null
    // By the session id too: the old machine's monitor may no longer list a session long stopped (BTN-1796).
    const sessionId = old.sessionId ?? undefined
    try {
      const head = await reader.chats.transcriptPart(old.id, 0, 0, sessionId)
      if (head === null) {
        this.deps.log(`chats: ${old.id}: its transcript was not found on ${from} and stays there if it is anywhere`)
        return null
      }
      if (head.size > TRANSCRIPT_COPY_BYTES) {
        this.deps.log(`chats: ${old.id}: its transcript of ${head.size} bytes is over the copy's limit and stays on ${from}`)
        return null
      }
      const parts: Buffer[] = []
      for (let at = 0; at < head.size; ) {
        const part = await reader.chats.transcriptPart(old.id, at, TRANSCRIPT_PART_BYTES, sessionId)
        const data = part === null ? Buffer.alloc(0) : Buffer.from(part.data, 'base64')
        if (data.length === 0) throw new Error(`the transcript ended at ${at} of ${head.size} bytes`)
        parts.push(data)
        at += data.length
      }
      const [path] = await to.chat.saveInbox(old.project, folder, [{ name: head.name, data: Buffer.concat(parts).toString('base64') }])
      this.deps.log(`chats: ${old.id}: its transcript was carried from ${from} to ${path}`)
      return path ?? null
    } catch (error) {
      this.deps.log(`chats: ${old.id}: its transcript was not carried from ${from}: ${messageOf(error)}`)
      return null
    }
  }

  /** Stops the chat's session through its machine, mid-turn too (`docs/chain/exceptions.md`); throws why it did not. */
  private async stop(chat: ChatRecord): Promise<void> {
    if (chat.sessionId === null || chat.machine === null) return
    const services = this.deps.services(chat.machine)
    if (services === undefined) throw fail('chats.noMachine', {})
    await services.chats.stop(chat.id)
  }

  /**
   * The chat's session process is up: its launch is under way, or the machine's view of it is not `finished`. One
   * stopped as idle counts as stopped for `STOP_SEEN_MS`, while that view may still be the one from before the stop.
   */
  private running(chat: ChatRecord): boolean {
    if (this.starting.has(chat.id)) return true
    const stoppedAt = this.idled.get(chat.id)
    if (stoppedAt !== undefined) {
      if (this.deps.now().getTime() - stoppedAt < STOP_SEEN_MS) return false
      this.idled.delete(chat.id)
    }
    const view = this.viewOf(chat)
    return view !== undefined && view.lamp !== 'finished'
  }

  /**
   * Before a session of `chat` comes up on `machine`: stops the machine's longest idle chat sessions over the
   * `chatSessions` ceiling (BTN-1653, exception 11). A stop that fails is a line in the log; the launch goes on.
   */
  private async makeRoom(chat: ChatRecord, machine: string): Promise<void> {
    const live = this.deps.store.active().filter((other) => other.id !== chat.id && other.machine === machine && this.running(other))
    const ceiling = this.deps.ceiling()
    const cards = live.map((other) => ({ id: other.id, state: this.cardOf(other).state, lastAt: lastAtOf(other, this.viewOf(other)) }))
    for (const id of roomFor(cards, ceiling)) {
      const other = live.find((each) => each.id === id)!
      await this.stopIdle(other, `${chat.id} starts on its machine past the ceiling of ${ceiling} live chat sessions`)
    }
  }

  /** Stops an idle chat's session; the chat stays active and its next message resumes it. */
  private async stopIdle(chat: ChatRecord, why: string): Promise<void> {
    try {
      await this.stop(chat)
      this.idled.set(chat.id, this.deps.now().getTime())
      this.deps.log(`chats: ${chat.id}: the session ${chat.sessionId} stopped: ${why}`)
    } catch (error) {
      this.deps.log(`chats: ${chat.id}: the session ${chat.sessionId} was not stopped (${why}): ${messageOf(error)}`)
    }
  }

  private putArchived(chat: ChatRecord, successor: string | null): void {
    this.idled.delete(chat.id)
    const view = this.viewOf(chat)
    const now = this.deps.now().toISOString()
    this.deps.store.put({ ...chat, last: lastMessageOf(view) ?? chat.last, lastAt: lastAtOf(chat, view), archivedAt: now, successor, pending: null })
    this.deps.log(`chats: ${chat.id} of ${chat.project} went to the archive${successor === null ? '' : `, continued by ${successor}`}`)
  }

  /** What the machine knows of the chat's session; `null` — none, or the machine did not answer. */
  private async pastOf(chat: ChatRecord): Promise<ChatPast | null> {
    if (chat.sessionId === null || chat.machine === null) return null
    try {
      return (await this.deps.services(chat.machine)?.chats.past(chat.id, chat.sessionId)) ?? null
    } catch (error) {
      this.deps.log(`chats: ${chat.id}: its last turns were not read: ${messageOf(error)}`)
      return null
    }
  }

  /** Launches the chat's pending prompt; a failed launch drops it, so the user writes again in the chat. */
  private async launchPending(chat: ChatRecord, services: Pick<MachineServices, 'chats'>, folder: string): Promise<ChatCard> {
    const prompt = chat.pending
    if (prompt === null) return this.cardOf(chat)
    if (chat.machine !== null) await this.makeRoom(chat, chat.machine)
    this.starting.add(chat.id)
    this.deps.changed()
    let sessionId: string
    try {
      sessionId = await services.chats.launch(chat.project, folder, chat.id, { account: chat.account, ...startOf(chat, prompt) })
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
