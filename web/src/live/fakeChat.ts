import { fail } from '../../../src/notice/notice.js'
import type { Ask } from '../../../src/sessions/ask.js'
import type { Mail, SessionMail } from '../../../src/sessions/mail.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import type { EvenKeelState } from '../../../src/state.js'
import { picture } from './fakeCards.js'

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

/** Two screenshots read in one turn and a browser shot: tool lines first, then the image lines of their results. */
export function fakeShots(at: (minutes: number) => string): FeedLine[] {
  return [
    { at: at(25), kind: 'tool', text: 'Read .temp/shots/chain-dark.png', tool: 'toolu_fake_dark', name: 'Read', subject: `${ROOT}\\.temp\\shots\\chain-dark.png` },
    { at: at(25), kind: 'tool', text: 'Read .temp/shots/chain-light.png', tool: 'toolu_fake_light', name: 'Read', subject: `${ROOT}\\.temp\\shots\\chain-light.png` },
    { at: at(25), kind: 'image', text: 'chain-dark.png', tool: 'toolu_fake_dark', images: 1 },
    { at: at(25), kind: 'image', text: 'chain-light.png', tool: 'toolu_fake_light', images: 1 },
    { at: at(24), kind: 'tool', text: 'playwright browser_take_screenshot', tool: 'toolu_fake_browser', name: 'mcp__playwright__browser_take_screenshot' },
    { at: at(24), kind: 'image', text: '', tool: 'toolu_fake_browser', images: 1 },
  ]
}

const ROOT = 'C:\\repos\\example-project'

/** A long run of calls between two texts, one of them failed: the group line of the chat and what it opens into. */
export function fakeCalls(at: (minutes: number) => string): FeedLine[] {
  const call = (id: string, name: string, text: string, extra: Partial<FeedLine> = {}): FeedLine => ({ at: at(12), kind: 'tool', text, tool: id, name, ...extra })
  return [
    { at: at(13), kind: 'text', text: 'Ловлю цикл в `chainOrder` до сортировки: тест, правка, прогон.' },
    call('toolu_fake_c1', 'Read', 'Read src/chain/order.ts', { subject: `${ROOT}\\src\\chain\\order.ts` }),
    call('toolu_fake_c2', 'Grep', 'Grep blockedBy', { subject: 'blockedBy' }),
    call('toolu_fake_c3', 'Edit', 'Edit src/chain/order.test.ts', { subject: `${ROOT}\\src\\chain\\order.test.ts`, added: 21, removed: 0 }),
    call('toolu_fake_c4', 'Bash', 'Bash Run the chain tests', { subject: 'Run the chain tests', detail: 'npx vitest run src/chain' }),
    { at: at(12), kind: 'failed', text: 'Exit code 1\n FAIL  src/chain/order.test.ts > chainOrder > stops on a cycle\nAssertionError: expected [Function] to throw', tool: 'toolu_fake_c4' },
    call('toolu_fake_c5', 'Edit', 'Edit src/chain/order.ts', { subject: `${ROOT}\\src\\chain\\order.ts`, added: 8, removed: 3 }),
    call('toolu_fake_c6', 'Edit', 'Edit src/chain/order.ts', { subject: `${ROOT}\\src\\chain\\order.ts`, added: 2, removed: 1 }),
    call('toolu_fake_c7', 'Bash', 'Bash npx vitest run src/chain && npx tsc --noEmit', { detail: 'npx vitest run src/chain && npx tsc --noEmit' }),
    { at: at(12), kind: 'failed', text: 'Exit code -1\nnpx vitest run src/chain', tool: 'toolu_fake_c7', interrupted: true },
    { at: at(11), kind: 'text', text: 'Тесты зелёные. Цикл теперь — ошибка над цепочкой с задачами цикла.' },
    call('toolu_fake_c8', 'Read', 'Read docs/chain.md', { subject: `${ROOT}\\docs\\chain.md` }),
  ]
}

const SHOTS: Record<string, string> = {
  toolu_fake_dark: picture(1280, 720, '#1c1c1a', '#2f5fd0', 'dark'),
  toolu_fake_light: picture(1280, 720, '#f4f3ef', '#1baf7a', 'light'),
  toolu_fake_browser: picture(390, 844, '#6b4fd0', '#eb6834', 'browser'),
}

export function fakeImageUrl(tool: string, index: number): string {
  return SHOTS[tool] ?? picture(640, 480, '#d2443a', '#1c1c1a', `${tool} ${index}`)
}

export function fakeSentFileUrl(name: string): string {
  return picture(800, 600, '#2a78d6', '#1baf7a', name)
}

const SHARED_AUDIT = [
  '# Опись ошибок',
  '',
  '| Место | Сейчас | Станет |',
  '| --- | --- | --- |',
  '| `config.unknownProject` | путь конфига | название проекта и кнопка |',
  '| `ci.noToken` | имя переменной | «Добавьте токен» и переход к ключам |',
  '',
  '## Сценарии',
  '',
  ...Array.from({ length: 20 }, (_, index) => `${index + 1}. Сценарий проверки номер ${index + 1}: открыть страницу, вызвать ошибку, прочитать текст.`),
].join('\n')

/** A share of the session: a markdown audit, a screenshot, an archive, and a file its cleaned-up worktree took with it. */
export function fakeShare(at: (minutes: number) => string): FeedLine[] {
  const files = ['audit.md', 'chain-dark.png', 'logs.zip', 'plan.md'].map((name) => `${ROOT}\\.temp\\${name}`)
  return [
    {
      at: at(8),
      kind: 'tool',
      text: 'SendUserFile Опись ошибок и 20 сценариев',
      tool: 'toolu_fake_share',
      name: 'SendUserFile',
      share: { caption: 'Опись ошибок и 20 сценариев — до правок', files, folder: ROOT },
    },
    { at: at(8), kind: 'text', text: 'Опись и 20 сценариев (файл audit.md выше) — что делаем?' },
  ]
}

export function fakeSharedUrl(tool: string, index: number): string {
  if (index === 0) return `data:text/markdown;charset=utf-8,${encodeURIComponent(SHARED_AUDIT)}`
  if (index === 1) return SHOTS.toolu_fake_dark!
  if (index === 2) return `data:application/zip;base64,UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==`
  return `http://127.0.0.1:9/${tool}/${index}`
}

/** The tool line of the question the session waits on, at the end of the transcript; an unsaved one has none. */
export function fakeOpenAsk(open: Ask | null): FeedLine[] {
  return open === null || open.unsaved ? [] : [{ at: new Date().toISOString(), kind: 'tool', text: `AskUserQuestion ${open.questions[0]!.question}`, ask: open }]
}

/**
 * `session/answer`: the waiting session takes the reply and goes back to work; a working one that steers takes the
 * message as it is, and one whose hooks listen gets it into its mailbox, for `fakeDeliverMail` to hand over a few
 * seconds later.
 */
export function fakeAnswer(state: EvenKeelState, body: Record<string, unknown>): EvenKeelState {
  const task = String(body.task)
  const view = state.sessions.find((each) => each.task === task && each.sessionId === body.sessionId)
  if (view === undefined || (view.ask?.id ?? null) !== body.ask) throw fail('answer.moved', { task })
  const box = state.mailbox[view.sessionId]
  if (view.lamp === 'working' && box?.steers === true && body.ask === null) return state
  if (view.lamp === 'working' && box?.listens === true && body.ask === null) {
    const mail = fakeMail(task, view.sessionId, Date.now(), String(body.text), 'waiting')
    return { ...state, mailbox: { ...state.mailbox, [view.sessionId]: { ...box, mail: [...box.mail, mail] } } }
  }
  if (view.lamp === 'working') throw fail('answer.busy', { task })
  const working = { ...view, lamp: 'working' as const, asking: false, ask: null, waitingFor: null, apiError: null, apiErrorKind: null }
  const dismissed = withMail(state, view.sessionId, (each) => (each.fate === 'returned' ? { ...each, fate: 'dismissed' } : each))
  const active = dismissed.chain.active.map((chain) => {
    if (chain.current?.sessionId !== view.sessionId) return chain
    const { limit: _limit, ...current } = chain.current
    return { ...chain, current }
  })
  return { ...dismissed, chain: { ...dismissed.chain, active }, sessions: state.sessions.map((each) => (each === view ? working : each)) }
}

/** The fake hook: every message that waits is taken after a tool call. */
export function fakeDeliverMail(state: EvenKeelState): EvenKeelState {
  const settledAt = new Date().toISOString()
  return Object.keys(state.mailbox).reduce(
    (now, sessionId) => withMail(now, sessionId, (each) => (each.fate === 'waiting' ? { ...each, fate: 'delivered', event: 'PostToolUse', settledAt } : each)),
    state,
  )
}

/** `session/mail/dismiss`: the returned messages leave the chat. */
export function fakeDismissMail(state: EvenKeelState, sessionId: string): EvenKeelState {
  return withMail(state, sessionId, (each) => (each.fate === 'returned' ? { ...each, fate: 'dismissed' } : each))
}

/**
 * `?chain=mail`: the working session of ABC-5 listens, one message was delivered, one waits for the hook, one came back
 * after a question and one after the task's branch landed in main (BTN-558).
 */
export function fakeMailbox(task: string, sessionId: string, now: number): SessionMail {
  const minutes = (count: number) => now - count * 60_000
  return {
    listens: true,
    steers: false,
    mail: [
      { ...fakeMail(task, sessionId, minutes(1), 'Не трогай миграции, только чтение.', 'delivered'), event: 'PostToolUse', settledAt: new Date(now).toISOString() },
      { ...fakeMail(task, sessionId, minutes(3), 'И проверь тёмную тему на узком экране — карточки там переносятся в две строки.', 'returned'), reason: 'asked' },
      { ...fakeMail(task, sessionId, minutes(2), 'И шрифт на плашках ошибок сделай поменьше.', 'returned'), reason: 'closed' },
      fakeMail(task, sessionId, minutes(0.2), 'Ещё учти: порядок задач берём из blocks, не из приоритета.', 'waiting'),
    ],
  }
}

let mailIds = 100

function fakeMail(task: string, sessionId: string, at: number, text: string, fate: Mail['fate']): Mail {
  const postedAt = new Date(at).toISOString()
  return { id: mailIds++, task, sessionId, text, files: [], postedAt, fate, event: null, reason: null, settledAt: fate === 'waiting' ? null : postedAt }
}

function withMail(state: EvenKeelState, sessionId: string, change: (mail: Mail) => Mail): EvenKeelState {
  const box = state.mailbox[sessionId]
  if (box === undefined) return state
  const mail = box.mail.map(change).filter((each) => each.fate !== 'dismissed')
  return { ...state, mailbox: { ...state.mailbox, [sessionId]: { ...box, mail } } }
}
