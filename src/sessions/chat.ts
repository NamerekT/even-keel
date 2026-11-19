import type { Dispatcher } from '../chain/dispatcher.js'
import type { HandoffSession } from '../chain/relay.js'
import type { Language } from '../language.js'
import { fromCarried, type MachineChat } from '../machine/services.js'
import { fail } from '../notice/notice.js'
import type { SessionView } from '../state.js'
import { replyPrompt, type Reply } from './ask.js'
import { saveInbox, type InboxFile } from './inbox.js'
import type { Mailbox } from './mailbox.js'
import type { MailRelay } from './mailRelay.js'

interface ChatDeps {
  dispatcher: Pick<Dispatcher, 'answerable' | 'answer' | 'renew' | 'closed'>
  /** Brings the hub's mirror of its machine up to date: the dispatcher accepts or refuses a reply by it. */
  catchUp?: () => Promise<void>
  mailbox: Mailbox
  configuredProject: (task: string) => string | undefined
  /** The hub's reads of a reply's session, from its mirror of the machine. */
  liveView: (task: string) => Pick<SessionView, 'sessionId' | 'asking' | 'ask'> | undefined
  /** The same mirror's sessions, for the chat's messages they got and never answered (`MailRelay.unanswered`). */
  sessions?: () => Pick<SessionView, 'task' | 'sessionId' | 'lamp' | 'unansweredMail'>[]
  midTurn: (task: string) => boolean
  steering: (sessionId: string) => boolean
  /**
   * The machine's own read of the task's live session, for settling its mailbox: the machine settles it right after its
   * monitor's read, before the mirror has it. Absent — the reads above.
   */
  machineLive?: MailRelay['live']
  steer: (task: string, session: HandoffSession, prompt: string) => Promise<boolean>
  /**
   * What a reply does on the machine — the mailbox, the steer, the files in the session's folder — as the link's commands
   * (`MachineServices.chat`). Absent — `mailbox` and `steer` in this process.
   */
  chat?: MachineChat
  /** The session takes chat messages mid-turn (its hooks asked, or it steers), from the hub's mirror; absent — `mailbox`. */
  listens?: (sessionId: string) => boolean
  language: (project?: string) => Language
  /** The task's handoff note (`noteFileOf`), for a `/handoff` from the page (BTN-964); absent — the shared one. */
  note?: (task: string) => string
  changed: () => void
  log: (line: string) => void
  now: () => Date
}

/** The chat's commands made on the mailbox and the folders of this process. */
export function localChat(mailbox: Mailbox, steer: MachineChat['steer']): MachineChat {
  return {
    post: async (task, sessionId, text, files) => {
      if (!mailbox.listens(sessionId)) throw fail('answer.busy', { task })
      mailbox.post(task, sessionId, text, files)
    },
    giveBack: async (task, sessionId, text, files, reason) => void mailbox.giveBack(task, sessionId, text, files, reason),
    dismiss: async (sessionId) => mailbox.dismiss(sessionId),
    steer,
    saveInbox: (_project, workdir, files) => saveInbox(workdir, files.map((file) => ({ name: file.name, data: fromCarried(file) }))),
  }
}

export function createChat(deps: ChatDeps) {
  const { dispatcher, mailbox } = deps
  const chat = deps.chat ?? localChat(mailbox, deps.steer)
  const listens = deps.listens ?? ((sessionId: string) => deps.steering(sessionId) || mailbox.listens(sessionId))
  const mailRelay: MailRelay = {
    mailbox,
    ...(deps.note === undefined ? {} : { note: deps.note }),
    live: deps.machineLive ?? ((task) => {
      const view = deps.liveView(task)
      return view === undefined ? undefined : { sessionId: view.sessionId, midTurn: deps.midTurn(task), asking: view.asking }
    }),
    ...(deps.sessions === undefined ? {} : {
      unanswered: () => deps.sessions!().flatMap(({ task, sessionId, lamp, unansweredMail }) =>
        lamp === 'finished' || unansweredMail === undefined ? [] : [{ task, sessionId, mail: unansweredMail }]),
    }),
    resume: async (task, sessionId, prompt) => {
      const project = deps.configuredProject(task)
      if (project === undefined) throw fail('config.unknownProject', { key: task })
      await deps.catchUp?.()
      return dispatcher.answer(project, task, sessionId, null, prompt)
    },
    closed: async (task) => {
      const project = deps.configuredProject(task)
      return project !== undefined && (await dispatcher.closed(project, task))
    },
    language: deps.language,
    changed: deps.changed,
    log: deps.log,
    now: deps.now,
  }

  /**
   * Saves attachments and routes a page or tracker reply to the session or its mailbox. `renew` — the user chose
   * "New session with this message" for a session whose cache went cold (BTN-757): a session that waits is replaced by
   * a new one with the reply; one mid-turn takes it as usual, its cache is warm.
   */
  async function answerSession(
    project: string,
    task: string,
    sessionId: string,
    ask: string | null,
    reply: Omit<Reply, 'files'> & { files: InboxFile[] },
    renew = false,
  ): Promise<void> {
    await deps.catchUp?.()
    const takes = reply.from === 'page' && listens(sessionId)
    const { session, midTurn } = dispatcher.answerable(project, task, sessionId, ask, takes)
    // What the message asks would land in the worktree of a closed task: it is a new task (BTN-558).
    if (await dispatcher.closed(project, task)) throw fail('answer.closed', { task })
    const question = ask === null ? null : (deps.liveView(task)?.ask ?? null)
    let files: string[]
    try {
      const carried = reply.files.map((file) => ({ name: file.name, data: Buffer.from(file.data).toString('base64') }))
      files = carried.length === 0 ? [] : await chat.saveInbox(project, session.workdir, carried)
    } catch (error) {
      throw fail('answer.file', { name: reply.files.map((file) => file.name).join(', ') }, { detail: (error as Error).message }, { cause: error })
    }
    const prompt = replyPrompt({ ...reply, files }, question, deps.language(project), deps.note?.(task))
    if (midTurn) {
      if (deps.steering(sessionId) && (await chat.steer(task, session, prompt))) {
        deps.log(`chain: ${task}: the user's message from the page went into the working session ${sessionId}${files.length > 0 ? ` with ${files.length} file(s)` : ''}`)
        return
      }
      await chat.post(task, sessionId, reply.text, files)
      deps.log(`chain: ${task}: the user's message from the page waits in the mailbox of the session ${sessionId}${files.length > 0 ? ` with ${files.length} file(s)` : ''}`)
      deps.changed()
      return
    }
    const withFiles = files.length > 0 ? ` with ${files.length} file(s)` : ''
    // The answer is the chain's already: the returned messages it replaces leave the chat window without holding it.
    const dismiss = () => void chat.dismiss(sessionId).catch((error: unknown) => deps.log(`chain: ${task}: the returned messages of ${sessionId} stay in the chat: ${(error as Error).message}`))
    if (renew) {
      dispatcher.renew(project, task, sessionId, ask, prompt)
      dismiss()
      deps.log(`chain: ${task}: the user's answer from the ${reply.from}${withFiles} goes to a new session instead of ${sessionId}, whose cache went cold`)
      return
    }
    const delivery = dispatcher.answer(project, task, sessionId, ask, prompt)
    dismiss()
    deps.log(`chain: ${task}: the user's answer from the ${reply.from} goes to the session ${sessionId}${withFiles}`)
    void delivery.catch(() => false).then((delivered) => (delivered ? undefined : giveBack(project, task, sessionId, reply.text, files)))
  }

  /** The answer waited in turn and never reached its session (BTN-1331): it comes back to the chat, not into the log alone. */
  async function giveBack(project: string, task: string, sessionId: string, text: string, files: string[]): Promise<void> {
    try {
      const reason = (await dispatcher.closed(project, task)) ? 'closed' : 'gone'
      await chat.giveBack(task, sessionId, text, files, reason)
      deps.log(`chain: ${task}: the user's answer went back to the chat: ${reason === 'closed' ? 'the task is over for the chain' : 'it did not reach the session'} ${sessionId}`)
      deps.changed()
    } catch (error) {
      deps.log(`chain: ${task}: the user's answer that did not reach the session ${sessionId} is not in the chat either: ${(error as Error).message}`)
    }
  }

  return { mailRelay, answerSession }
}
