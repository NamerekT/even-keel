import type { TaskComment } from '../../../src/tracker/card.js'
import type { TaskChange } from '../../../src/tracker/history.js'

/**
 * The journal of a fake built-in task (BTN-774), kept per task while the page lives so a note sent or deleted stays.
 * `?journal=empty|long|asked`: no entries, 25 of them (20 shown, "5 more" above), a session's question and its answer.
 * Otherwise an agent report with its model, Even Keel's `NO CHANGES:` and the person's own note.
 */
const journals = new Map<string, TaskComment[]>()
let next = 1

const HOUR = 3_600_000

function entry(by: 'person' | 'agent' | 'service', text: string, hoursAgo: number, model: string | null = null): TaskComment {
  const id = `fake-${next++}`
  return { author: by === 'person' ? 'John Doe' : null, at: Date.now() - hoursAgo * HOUR, text, journal: { id, by, model } }
}

function seeded(mode: string | null): TaskComment[] {
  switch (mode) {
    case 'empty':
      return []
    case 'long':
      return Array.from({ length: 25 }, (_, index) =>
        index % 3 === 0
          ? entry('agent', `Шаг ${index + 1}: тесты порядка цепочки зелёные, дальше — разбор ответа трекера.`, 50 - index * 2, 'Claude | opus')
          : index % 3 === 1
            ? entry('person', `Заметка ${index + 1}: проверить на задаче без вехи.`, 49 - index * 2)
            : entry('service', `Сессия остановлена на контрольной точке, продолжение — новая сессия.`, 48 - index * 2),
      )
    case 'asked':
      return [
        entry('agent', 'Начинаю: читаю `src/tracker/questions.ts` и тесты вопросов.', 5, 'Claude | sonnet'),
        entry(
          'service',
          '**Сессия ждёт ответа**\n\n- Какой порядок у задач без связей?\n  - По номеру\n  - По приоритету\n\nОтвет — в чате сессии на странице: заметка здесь сессии не дойдёт.',
          4,
        ),
        entry('person', '**Ответ сессии**\n\n- «Какой порядок у задач без связей?» → По приоритету\n\nПри равном приоритете — по номеру.', 3),
        entry('agent', 'Готово: порядок по приоритету, при равном — по номеру. Тесты `chain.test.ts` дополнены.', 1, 'Claude | sonnet'),
      ]
    default:
      return [
        entry('agent', 'Сделано: порядок задач берётся из связей `blocks`, вехи идут по дате. Тесты зелёные, ветка слита.', 26, 'Claude | opus'),
        entry('service', '`NO CHANGES:` задача уже сделана в основной ветке.', 20),
        entry('person', 'Проверить на проекте с двумя вехами без даты.', 2),
      ]
  }
}

export function fakeJournal(task: string, mode: string | null): TaskComment[] {
  if (!journals.has(task)) journals.set(task, seeded(mode))
  return journals.get(task)!
}

/** A mixed journal with every kind of change for the desktop and phone checks. */
export function fakeHistory(mode: string | null): TaskChange[] {
  if (mode !== 'history' && mode !== 'history-long') return []
  const now = Date.now()
  const change = (hours: number, field: TaskChange['field'], from: string | null, to: string | null, by: TaskChange['by'] = 'person', model: string | null = null): TaskChange => ({ at: now - hours * HOUR, by, model, field, from, to })
  const changes: TaskChange[] = [
    change(30, 'created', null, null),
    change(27, 'status', 'Backlog', 'Todo'),
    change(27, 'label', null, 'Bug'),
    change(27, 'label', 'Server', null),
    change(27, 'estimate', '20', '40'),
    change(27, 'milestone', null, 'v0.4'),
    change(25, 'status', 'Todo', 'In Progress', 'service'),
    { ...change(24, 'description', null, null, 'agent', 'Claude | opus'), diff: [{ kind: 'skipped', lines: 12 }, { kind: 'same', text: 'Read the task.' }, { kind: 'removed', text: 'Only comments.' }, { kind: 'added', text: 'Comments and changes, oldest first.' }] },
    change(24, 'run', null, '{"provider":"claude","model":"opus","effort":"high"}', 'agent', 'Claude | opus'),
    change(24, 'blocks', null, 'ABC-2', 'agent', 'Claude | opus'),
    change(21, 'status', 'In Progress', 'Done', 'service'),
  ]
  return mode === 'history-long' ? [...Array.from({ length: 25 }, (_, index) => change(70 - index, 'title', `Old title ${index}`, `New title ${index}`, 'agent', 'OpenCode | openrouter/example/a-very-long-model-name')), ...changes] : changes
}

/** `builtin/comment` and `builtin/uncomment`: `false` — not one of them. */
export function fakeJournalQuery(name: string, body: Record<string, unknown>, mode: string | null): boolean {
  const task = String(body.task ?? '')
  if (name === 'builtin/comment') {
    journals.set(task, [...fakeJournal(task, mode), entry('person', String(body.text ?? ''), 0)])
    return true
  }
  if (name === 'builtin/uncomment') {
    journals.set(
      task,
      fakeJournal(task, mode).filter((each) => each.journal?.id !== body.comment),
    )
    return true
  }
  return false
}
