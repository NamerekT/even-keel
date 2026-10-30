import type { Dispatcher } from '../chain/dispatcher.js'
import type { HandoffSession } from '../chain/relay.js'
import type { Language } from '../language.js'
import { fail } from '../notice/notice.js'
import type { SessionView } from '../state.js'
import { replyPrompt, type Reply } from './ask.js'
import { saveInbox, type InboxFile } from './inbox.js'
import type { Mailbox } from './mailbox.js'
import type { MailRelay } from './mailRelay.js'

interface ChatDeps {
  dispatcher: Pick<Dispatcher, 'answerable' | 'answer' | 'closed'>
  mailbox: Mailbox
  configuredProject: (task: string) => string | undefined
  liveView: (task: string) => Pick<SessionView, 'sessionId' | 'asking' | 'ask'> | undefined
  midTurn: (task: string) => boolean
  steering: (sessionId: string) => boolean
  steer: (task: string, session: HandoffSession, prompt: string) => Promise<boolean>
  language: (project?: string) => Language
  changed: () => void
  log: (line: string) => void
  now: () => Date
}

export function createChat(deps: ChatDeps) {
  const { dispatcher, mailbox } = deps
  const mailRelay: MailRelay = {
    mailbox,
    live: (task) => {
      const view = deps.liveView(task)
      return view === undefined ? undefined : { sessionId: view.sessionId, midTurn: deps.midTurn(task), asking: view.asking }
    },
    resume: (task, sessionId, prompt) => {
      const project = deps.configuredProject(task)
      if (project === undefined) throw fail('config.unknownProject', { key: task })
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

  /** Saves attachments and routes a page or tracker reply to the session or its mailbox. */
  async function answerSession(
    project: string,
    task: string,
    sessionId: string,
    ask: string | null,
    reply: Omit<Reply, 'files'> & { files: InboxFile[] },
  ): Promise<void> {
    const takes = reply.from === 'page' && (deps.steering(sessionId) || mailbox.listens(sessionId))
    const { session, midTurn } = dispatcher.answerable(project, task, sessionId, ask, takes)
    // What the message asks would land in the worktree of a closed task: it is a new task (BTN-558).
    if (await dispatcher.closed(project, task)) throw fail('answer.closed', { task })
    const question = ask === null ? null : (deps.liveView(task)?.ask ?? null)
    let files: string[]
    try {
      files = await saveInbox(session.workdir, reply.files)
    } catch (error) {
      throw fail('answer.file', { name: reply.files.map((file) => file.name).join(', ') }, { detail: (error as Error).message }, { cause: error })
    }
    const prompt = replyPrompt({ ...reply, files }, question, deps.language(project))
    if (midTurn) {
      if (deps.steering(sessionId) && (await deps.steer(task, session, prompt))) {
        deps.log(`chain: ${task}: the user's message from the page went into the working session ${sessionId}${files.length > 0 ? ` with ${files.length} file(s)` : ''}`)
        return
      }
      if (!mailbox.listens(sessionId)) throw fail('answer.busy', { task })
      mailbox.post(task, sessionId, reply.text, files)
      deps.log(`chain: ${task}: the user's message from the page waits in the mailbox of the session ${sessionId}${files.length > 0 ? ` with ${files.length} file(s)` : ''}`)
      deps.changed()
      return
    }
    dispatcher.answer(project, task, sessionId, ask, prompt)
    mailbox.dismiss(sessionId)
    deps.log(`chain: ${task}: the user's answer from the ${reply.from} goes to the session ${sessionId}${files.length > 0 ? ` with ${files.length} file(s)` : ''}`)
  }

  return { mailRelay, answerSession }
}
