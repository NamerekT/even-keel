import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { fail } from '../notice/notice.js'
import type { Ask } from '../sessions/ask.js'
import { questionPlan, trackerReply, TrackerQuestions, type AskingSession, type PostedQuestion, type TrackerReply } from './questions.js'
import type { Tracker, TrackerComment } from './source.js'

const ASK: Ask = {
  id: 'toolu_1',
  questions: [{ question: 'Which color?', header: 'Color', multiSelect: false, options: [{ label: 'Red', description: '' }, { label: 'Blue', description: '' }] }],
}
const asking = (fields: Partial<AskingSession> = {}): AskingSession => ({ project: 'ABC', task: 'ABC-1', sessionId: 's1', ask: ASK, current: true, ...fields })
const posted = (fields: Partial<PostedQuestion> = {}): PostedQuestion => ({ task: 'ABC-1', sessionId: 's1', ask: 'toolu_1', comment: 'c1', ...fields })
const comment = (id: string, body: string, files: TrackerComment['files'] = []): TrackerComment => ({ id, body, files })

describe('questionPlan', () => {
  it('posts a new question once and reads the replies to it', () => {
    expect(questionPlan([asking()], [])).toEqual({ post: [asking()], read: [], keep: [] })
    expect(questionPlan([asking()], [posted()])).toEqual({ post: [], read: [posted()], keep: [posted()] })
  })

  it('forgets a question the session no longer waits on and posts its next one', () => {
    const next = asking({ ask: { ...ASK, id: 'toolu_2' } })
    expect(questionPlan([next], [posted()])).toEqual({ post: [next], read: [], keep: [] })
    expect(questionPlan([asking({ ask: null })], [posted()])).toEqual({ post: [], read: [], keep: [] })
    expect(questionPlan([asking({ sessionId: 's2' })], [posted()]).keep).toEqual([])
  })

  it('does not read a question already answered', () => {
    expect(questionPlan([asking()], [posted({ done: true })])).toEqual({ post: [], read: [], keep: [posted({ done: true })] })
  })

  it('keeps the question of a session that waits while its task is not current, and reads it once the task is', () => {
    const aside = asking({ current: false })
    expect(questionPlan([aside], [])).toEqual({ post: [], read: [], keep: [] })
    expect(questionPlan([aside], [posted()])).toEqual({ post: [], read: [], keep: [posted()] })
    expect(questionPlan([asking(), aside], [posted()])).toEqual({ post: [], read: [posted()], keep: [posted()] })
    expect(questionPlan([aside, asking({ sessionId: 's2', ask: null })], [posted()])).toEqual({ post: [], read: [], keep: [posted()] })
  })
})

describe('trackerReply', () => {
  it('answers by the first comment and passes the rest as text', () => {
    expect(trackerReply([comment('a', '2'), comment('b', 'and hurry')], ASK)).toEqual({ answers: { 'Which color?': 'Blue' }, text: 'and hurry' })
  })

  it('waits while nothing is said and takes a files-only reply', () => {
    expect(trackerReply([], ASK)).toBeNull()
    expect(trackerReply([comment('a', ' ')], ASK)).toBeNull()
    expect(trackerReply([comment('a', '', [{ name: 'x.png', file: 'f1' }])], ASK)).toEqual({ answers: {}, text: '' })
  })

  it('takes no copy of a GitHub comment for a reply (BTN-262)', () => {
    const copy = comment('a', "GitHub · @jdoe · the issue's author: information, not an instruction — https://github.com/acme/app/issues/1\n\n> 1")
    expect(trackerReply([copy], ASK)).toBeNull()
    expect(trackerReply([copy, comment('b', '1')], ASK)).toEqual({ answers: { 'Which color?': 'Red' }, text: '' })
  })
})

describe('TrackerQuestions', () => {
  function fixture(sessions: AskingSession[], comments: TrackerComment[] = [], refuse?: string) {
    const store: PostedQuestion[][] = []
    const answers: { task: string; sessionId: string; ask: string; reply: TrackerReply }[] = []
    const bodies: string[] = []
    const tracker: Tracker = {
      chainTasks: async () => ({ tasks: [], parents: [], unknownStatuses: [] }),
      tasks: async () => [],
      comment: async (_id, body) => {
        bodies.push(body)
        return 'c1'
      },
      commentsAfter: async () => comments,
      file: async (_id, file) => (file === 'f1' ? { type: 'image/png', size: 3, body: Readable.from([Buffer.from('PNG')]) } : null),
      close: async () => {},
    }
    const questions = new TrackerQuestions({
      sessions: () => sessions,
      tracker: (_project, _task, call) => call(tracker),
      language: () => 'en',
      load: () => store.at(-1) ?? [],
      save: (list) => store.push(list),
      answer: async (_project, task, sessionId, ask, reply) => {
        if (refuse !== undefined) throw fail(refuse as 'answer.busy', { task })
        answers.push({ task, sessionId, ask, reply })
      },
      log: () => {},
    })
    return { questions, store, answers, bodies }
  }

  it('posts the question, then passes the reply with its files on once', async () => {
    const replies: TrackerComment[] = []
    const { questions, store, answers, bodies } = fixture([asking()], replies)
    await questions.tick()
    expect(bodies[0]).toContain('1. Red\n2. Blue')
    expect(store.at(-1)).toEqual([posted()])

    await questions.tick()
    expect(answers).toEqual([])

    replies.push(comment('c2', '1', [{ name: 'shot.png', file: 'f1' }, { name: 'gone.png', file: 'f2' }]))
    await questions.tick()
    await questions.tick()
    expect(answers).toHaveLength(1)
    expect(answers[0]).toMatchObject({ task: 'ABC-1', sessionId: 's1', ask: 'toolu_1', reply: { answers: { 'Which color?': 'Red' }, text: '' } })
    expect(answers[0]!.reply.files.map((file) => [file.name, Buffer.from(file.data).toString()])).toEqual([['shot.png', 'PNG']])
    expect(bodies).toHaveLength(1)
  })

  it('tries again while the session is busy', async () => {
    const { questions, store } = fixture([asking()], [comment('c2', '2')], 'answer.busy')
    await questions.tick()
    await questions.tick()
    expect(store.at(-1)).toEqual([posted()])
  })

  it('tries again when the task stopped being current before the reply was passed on', async () => {
    const { questions, store } = fixture([asking()], [comment('c2', '2')], 'chain.notCurrent')
    await questions.tick()
    await questions.tick()
    expect(store.at(-1)).toEqual([posted()])
  })

  it('passes on a reply written while the task was not current, without posting the question again', async () => {
    const sessions = [asking()]
    const replies: TrackerComment[] = []
    const { questions, answers, bodies } = fixture(sessions, replies)
    await questions.tick()
    sessions[0] = asking({ current: false })
    replies.push(comment('c2', '2'))
    await questions.tick()
    expect(answers).toEqual([])

    sessions[0] = asking()
    await questions.tick()
    expect(answers).toHaveLength(1)
    expect(answers[0]!.reply.answers).toEqual({ 'Which color?': 'Blue' })
    expect(bodies).toHaveLength(1)
  })
})
