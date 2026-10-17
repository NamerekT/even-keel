import { fail } from '../../../src/notice/notice.js'
import type { Ask } from '../../../src/sessions/ask.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import type { EvenKeelState } from '../../../src/state.js'

/** The question ABC-5 waits on in `?chain=ask`: a single choice with previews and a multi-select. */
export const FAKE_ASK: Ask = {
  id: 'toolu_fake_open',
  questions: [
    {
      question: 'Как показывать цикл в цепочке?',
      header: 'Цикл',
      multiSelect: false,
      options: [
        {
          label: 'Ошибкой над цепочкой (Recommended)',
          description: 'Цепочка встаёт, ошибка называет задачи цикла.',
          preview: 'ABC-3 → ABC-5 → ABC-3\n\n  ✕ chain stopped: cycle\n    ABC-3 blocks ABC-5\n    ABC-5 blocks ABC-3',
        },
        {
          label: 'Пропускать задачи цикла',
          description: 'Цепочка идёт дальше, задачи цикла уходят в пропущенные.',
          preview: 'ABC-1 ✓\nABC-2 ✓\nABC-3 ⤼ skipped (cycle)\nABC-5 ⤼ skipped (cycle)\nABC-6 …',
        },
      ],
    },
    {
      question: 'Какие проверки добавить?',
      header: 'Проверки',
      multiSelect: true,
      options: [
        { label: 'Тест порядка', description: 'order.test.ts: цикл из двух и из трёх задач.' },
        { label: 'Тест страницы', description: 'Ошибка цикла видна над цепочкой.' },
        { label: 'Живая проверка', description: 'Два связанных blocks в трекере.' },
      ],
    },
  ],
}

/** The same question as the job file gives it in `?chain=unsaved`, the transcript not having the call yet: no headers, previews or multi-select. */
export const FAKE_UNSAVED_ASK: Ask = {
  id: 'job:fake:open',
  unsaved: true,
  questions: FAKE_ASK.questions.map(({ question, options }) => ({
    question,
    header: '',
    multiSelect: false,
    options: options.map(({ label, description }) => ({ label, description })),
  })),
}

const PAST_ASK: Ask = {
  id: 'toolu_fake_past',
  questions: [
    {
      question: 'Где хранить порядок?',
      header: 'Порядок',
      multiSelect: false,
      options: [
        { label: 'В трекере', description: 'Связи blocks.' },
        { label: 'В Even Keel', description: 'state/chain.json.' },
      ],
    },
  ],
}

/** A question of the fake transcript answered a while ago. */
export function fakePastAsk(at: (minutes: number) => string): FeedLine[] {
  const question = PAST_ASK.questions[0]!.question
  return [
    { at: at(36), kind: 'tool', text: `AskUserQuestion ${question}`, ask: PAST_ASK },
    {
      at: at(34),
      kind: 'answer',
      text: 'Связи уже заведены, бери их.',
      answers: { ask: PAST_ASK.id, answers: { [question]: 'В трекере' } },
      files: ['C:\\repos\\example-project\\.temp\\inbox\\order.png'],
    },
  ]
}

/** The tool line of the question the session waits on, at the end of the transcript; an unsaved one has none. */
export function fakeOpenAsk(open: Ask | null): FeedLine[] {
  return open === null || open.unsaved ? [] : [{ at: new Date().toISOString(), kind: 'tool', text: `AskUserQuestion ${open.questions[0]!.question}`, ask: open }]
}

/** `session/answer`: the waiting session takes the reply and goes back to work. */
export function fakeAnswer(state: EvenKeelState, body: Record<string, unknown>): EvenKeelState {
  const task = String(body.task)
  const view = state.sessions.find((each) => each.task === task && each.sessionId === body.sessionId)
  if (view === undefined || (view.ask?.id ?? null) !== body.ask) throw fail('answer.moved', { task })
  if (view.lamp === 'working') throw fail('answer.busy', { task })
  const working = { ...view, lamp: 'working' as const, asking: false, ask: null, waitingFor: null }
  return { ...state, sessions: state.sessions.map((each) => (each === view ? working : each)) }
}
