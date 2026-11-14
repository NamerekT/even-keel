import type { TaskPriority } from '../../../src/tracker/model.js'
import type { EvenKeelState } from '../../../src/state.js'
import { task } from './fakeSessions.js'

const TOPICS = ['Экспорт отчёта', 'Фильтр журнала', 'Подсказка у поля', 'Импорт меток', 'Тёмная тема графика', 'Кнопка повтора', 'Сводка недели', 'Проверка ключа']
const PRIORITIES: TaskPriority[] = ['high', 'medium', 'low', 'none']
const MILESTONES = ['v0.3 — служба', 'v0.4 — выпуск', null]
const RUNS = [
  { provider: 'codex', model: 'gpt-6.1-sol', effort: 'high' },
  { provider: 'claude', model: 'opus', effort: null },
  { provider: 'opencode', model: 'router/vendor/deepseek-v4.1-flash-free', effort: null },
]

/** `?backlog=changed` (BTN-1135): ABC-19's outsider author changed its text after the entry label, so it waits in the backlog. */
export function withChangedText(state: EvenKeelState): EvenKeelState {
  const order = state.chain.projects['ABC']!
  const changed = { ...order, changed: ['ABC-19'], requiredLabel: { ...order.requiredLabel, 'ABC-19': false } }
  return { ...state, chain: { ...state.chain, projects: { ...state.chain.projects, ABC: changed } } }
}

/** `?backlog=many` (BTN-982): 64 more backlog tasks in ABC, every fifth with a run, so the panel shows "More" and the search has something to find. */
export function withLongBacklog(state: EvenKeelState): EvenKeelState {
  const made = Array.from({ length: 64 }, (_, index) => {
    const id = `ABC-${100 + index}`
    const title = `${TOPICS[index % TOPICS.length]} №${index + 1}`
    return task(id, title, 'Backlog', 'UnStarted', [], MILESTONES[index % MILESTONES.length]!, { priority: PRIORITIES[index % PRIORITIES.length]! })
  })
  const runs = Object.fromEntries(made.filter((_, index) => index % 5 === 0).map((each, index) => [each.id, RUNS[index % RUNS.length]!]))
  const order = state.chain.projects['ABC']!
  return {
    ...state,
    tasks: [...state.tasks, ...made],
    runs: { ...state.runs, ABC: { ...state.runs['ABC'], ...runs } },
    chain: { ...state.chain, projects: { ...state.chain.projects, ABC: { ...order, backlog: [...order.backlog, ...made.map((each) => each.id)] } } },
  }
}
