import type { Language } from '../language.js'
import { englishOf, noticeOf } from '../notice/notice.js'
import { questionComment, trackerAnswers, type Ask, type AskAnswers } from '../sessions/ask.js'
import type { InboxFile } from '../sessions/inbox.js'
import type { Tracker, TrackerComment } from './source.js'

/** A question Even Keel put to the user in the tracker: the comment it posted for an `AskUserQuestion` of a session. */
export interface PostedQuestion {
  task: string
  sessionId: string
  ask: string
  comment: string
  /** The reply was passed on or refused for good; the comment is not read again. */
  done?: boolean
}

/** A live session of a chain task and the question it waits on, if any. */
export interface AskingSession {
  project: string
  task: string
  sessionId: string
  ask: Ask | null
  /** The task is the current one of its chain: only then is its question posted and the replies read. */
  current: boolean
}

export interface TrackerReply {
  answers: AskAnswers
  text: string
  files: InboxFile[]
}

export interface QuestionsDeps {
  sessions: () => AskingSession[]
  /** Runs `call` on the project's tracker; `undefined` — the project has no tracker connected. */
  tracker: <T>(project: string, call: (tracker: Tracker) => Promise<T>) => Promise<T> | undefined
  /** The language of the project's prompts, which a question in its tracker is posted in. */
  language: (project: string) => Language
  load: () => PostedQuestion[]
  save: (posted: PostedQuestion[]) => void
  answer: (project: string, task: string, sessionId: string, ask: string, reply: TrackerReply) => Promise<void>
  log: (line: string) => void
}

const RETRIED = new Set(['answer.busy', 'chain.launching', 'chain.limitSpent', 'chain.notCurrent'])

const waitsOn = (session: AskingSession, question: PostedQuestion) =>
  session.task === question.task && session.sessionId === question.sessionId && session.ask?.id === question.ask

/**
 * What to do on a tick: post the new questions of current tasks, read the replies to the open ones, forget those the
 * session left. A question stays while its session waits on it, current or not, so a reply written meanwhile is read
 * once the chain takes the task again.
 */
export function questionPlan(sessions: AskingSession[], posted: PostedQuestion[]): { post: AskingSession[]; read: PostedQuestion[]; keep: PostedQuestion[] } {
  const keep = posted.filter((each) => sessions.some((session) => waitsOn(session, each)))
  const post = sessions.filter((session) => session.current && session.ask !== null && !keep.some((each) => each.task === session.task && each.ask === session.ask!.id))
  const read = keep.filter((each) => each.done !== true && sessions.some((session) => session.current && waitsOn(session, each)))
  return { post, read, keep }
}

/** The reply that comments after the question make: the first one answers the question, the rest go along as text. */
export function trackerReply(comments: TrackerComment[], ask: Ask): Omit<TrackerReply, 'files'> | null {
  const bodies = comments.map((comment) => comment.body.trim()).filter((body) => body !== '')
  const answers = bodies.length === 0 ? null : trackerAnswers(bodies[0]!, ask)
  if (answers !== null) return { answers, text: bodies.slice(1).join('\n\n') }
  if (bodies.length === 0 && comments.every((comment) => comment.files.length === 0)) return null
  return { answers: {}, text: bodies.join('\n\n') }
}

/**
 * Puts the `AskUserQuestion` of a chain session to the user as a tracker comment with numbered options, and passes
 * the comments posted after it on to the session as its answer. A session that waits does not comment, so whatever
 * comes after the question is the user's.
 */
export class TrackerQuestions {
  private posted: PostedQuestion[]
  private running = false

  constructor(private readonly deps: QuestionsDeps) {
    this.posted = deps.load()
  }

  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const sessions = this.deps.sessions()
      const plan = questionPlan(sessions, this.posted)
      if (plan.keep.length !== this.posted.length) this.store(plan.keep)
      for (const session of plan.post) await this.post(session)
      for (const question of plan.read) await this.read(question, sessions.find((session) => session.current && waitsOn(session, question))!)
    } finally {
      this.running = false
    }
  }

  private async post(session: AskingSession): Promise<void> {
    const ask = session.ask!
    try {
      const comment = await this.deps.tracker(session.project, async (tracker) =>
        tracker.comment === undefined || tracker.commentsAfter === undefined ? null : tracker.comment(session.task, questionComment(ask, this.deps.language(session.project))),
      )
      if (comment == null) return
      this.store([...this.posted, { task: session.task, sessionId: session.sessionId, ask: ask.id, comment }])
      this.deps.log(`tracker: ${session.task}: the session's question is posted as the comment ${comment}`)
    } catch (error) {
      this.deps.log(`tracker: ${session.task}: the session's question was not posted: ${englishOf(noticeOf(error))}`)
    }
  }

  private async read(question: PostedQuestion, session: AskingSession): Promise<void> {
    let reply: TrackerReply | null
    try {
      reply =
        (await this.deps.tracker(session.project, async (tracker) => {
          const comments = (await tracker.commentsAfter?.(question.task, question.comment)) ?? []
          const read = trackerReply(comments, session.ask!)
          if (read === null) return null
          return { ...read, files: await download(tracker, question.task, comments) }
        })) ?? null
    } catch (error) {
      this.deps.log(`tracker: ${question.task}: the replies to the question were not read: ${englishOf(noticeOf(error))}`)
      return
    }
    if (reply === null) return
    try {
      await this.deps.answer(session.project, question.task, question.sessionId, question.ask, reply)
    } catch (error) {
      const notice = noticeOf(error)
      this.deps.log(`tracker: ${question.task}: the reply from the tracker was not passed on: ${englishOf(notice)}`)
      if (RETRIED.has(notice.code)) return
    }
    this.store(this.posted.map((each) => (each === question ? { ...each, done: true } : each)))
  }

  private store(posted: PostedQuestion[]): void {
    this.posted = posted
    this.deps.save(posted)
  }
}

/** The files of the reply comments; one the tracker will not give stays a link in the text. */
async function download(tracker: Tracker, task: string, comments: TrackerComment[]): Promise<InboxFile[]> {
  const files: InboxFile[] = []
  for (const { name, file } of comments.flatMap((comment) => comment.files)) {
    try {
      const found = await tracker.file?.(task, file)
      if (found == null) continue
      const chunks: Uint8Array[] = []
      for await (const chunk of found.body) chunks.push(chunk)
      files.push({ name, data: Buffer.concat(chunks) })
    } catch {
      continue
    }
  }
  return files
}
