import { BUILTIN_LABELS, BUILTIN_STATUSES } from '../../../src/builtin/model.js'
import { fail } from '../../../src/notice/notice.js'
import type { EvenKeelState, ProjectTask } from '../../../src/state.js'
import type { TaskCard, TaskRef } from '../../../src/tracker/card.js'
import { runLabelOf, type TaskPriority } from '../../../src/tracker/model.js'
import { fakeCard } from './fakeCards.js'
import { fakeJournal, fakeJournalQuery } from './fakeJournal.js'

/**
 * `?card=builtin`: every card is one Even Keel keeps itself and edits in place; `?card=conflict` — the first title edit
 * meets the title changed meanwhile (BTN-771). Parents the fake lists no task for get one made up here.
 */
export const isBuiltinCard = (mode: string | null): boolean => mode === 'builtin' || mode === 'conflict'

const MADE_UP: Record<string, { title: string; parent: string | null }> = {
  'ABC-90': { title: 'Первый выпуск', parent: null },
  'ABC-16': { title: 'Ядро цепочки: порядок, сессии и журнал', parent: 'ABC-90' },
  'ABC-17': { title: 'Удобство работы с цепочкой', parent: 'ABC-90' },
}

const OWN_LABELS = ['UI', 'Docs', 'Backend']
const related = new Set<string>()
let conflicted = false

const pair = (a: string, b: string) => [a, b].sort().join(' ')
const refOf = (task: ProjectTask): TaskRef => ({ id: task.id, title: task.title, status: task.status })
const prefix = (id: string) => id.split('-')[0]!

/** The listed tasks and the made-up parents, so a parent's card and the path over a subtask both have something to show. */
function withParents(state: EvenKeelState): ProjectTask[] {
  const template = state.tasks.find((task) => task.project === 'ABC')
  if (template === undefined) return state.tasks
  const madeUp = Object.entries(MADE_UP)
    .filter(([id]) => !state.tasks.some((task) => task.id === id))
    .map(([id, { title, parent }]): ProjectTask => ({
      ...template,
      id,
      title,
      parent,
      status: { name: 'In Progress', category: 'Active' },
      blockedBy: [],
      labels: [],
      runLabels: [],
      question: false,
      subtasks: state.tasks.filter((task) => task.parent === id).length,
    }))
  return [...state.tasks, ...madeUp]
}

export function fakeBuiltinCard(state: EvenKeelState, id: string, journal: string | null): TaskCard | null {
  const tasks = withParents(state)
  const task = tasks.find((each) => each.id === id)
  const base = fakeCard({ ...state, tasks }, id, 'builtin')
  if (task === undefined || base === null) return null
  const find = (other: string) => tasks.find((each) => each.id === other)
  const ancestors: TaskRef[] = []
  for (let up = task.parent; up !== null; ) {
    const parent = find(up)
    if (parent === undefined || ancestors.some((each) => each.id === up)) break
    ancestors.unshift(refOf(parent))
    up = parent.parent
  }
  const own = new Set(tasks.flatMap((each) => each.labels).filter((name) => runLabelOf(name) === null))
  return {
    ...base,
    priority: task.priority,
    labels: [
      ...(task.question ? [{ name: 'Question', role: 'question' as const }] : []),
      ...task.labels.map((name) => ({ name, role: runLabelOf(name) === null ? null : ('model' as const) })),
    ],
    parent: ancestors.at(-1) ?? null,
    comments: fakeJournal(id, journal),
    related: tasks.filter((each) => related.has(pair(id, each.id))).map(refOf),
    edit: {
      statuses: [...BUILTIN_STATUSES],
      labels: [...BUILTIN_LABELS.map((name) => ({ name, builtin: true })), ...[...OWN_LABELS, ...own].filter((name, at, all) => all.indexOf(name) === at).map((name) => ({ name, builtin: false }))],
      ancestors,
      subtasks: tasks.filter((each) => each.parent === id).map((each) => ({ ...refOf(each), milestone: each.milestone?.label ?? null })),
      milestoneRules: { requiredMilestones: [], excludedMilestones: ['Когда-нибудь'] },
    },
  }
}

/** `refusal`: the service refused, after `state` changed (the conflict's other edit). */
type Answer = { state: EvenKeelState; result: unknown; refusal?: Error }

/** A `builtin/*` query against the fake's tasks; `null` — not one of them. */
export function fakeBuiltinQuery(state: EvenKeelState, name: string, body: Record<string, unknown>, mode: string | null, journal: string | null): Answer | null {
  if (!name.startsWith('builtin/')) return null
  if (fakeJournalQuery(name, body, journal)) return { state: { ...state }, result: {} }
  const task = String(body.task ?? '')
  const other = String(body.other ?? '')
  const change = (update: (each: ProjectTask) => ProjectTask, id = task): Answer => ({
    state: { ...state, tasks: state.tasks.map((each) => (each.id === id ? update(each) : each)) },
    result: null,
  })

  switch (name) {
    case 'builtin/search': {
      const text = String(body.text ?? '').trim().toLocaleLowerCase()
      const project = typeof body.project === 'string' ? body.project : null
      const found = withParents(state).filter(
        (each) => (project === null || each.project === project) && (text === '' || each.id.toLocaleLowerCase() === text || each.title.toLocaleLowerCase().includes(text)),
      )
      return { state, result: found.slice(0, 20).map(refOf) }
    }
    case 'builtin/edit':
      return fakeEdit(state, task, String(body.field), (body.to ?? null) as string | null, mode, change)
    case 'builtin/labels': {
      const add = (body.add ?? []) as string[]
      const remove = new Set(((body.remove ?? []) as string[]).map((each) => each.toLocaleLowerCase()))
      return change((each) => ({ ...each, labels: [...each.labels.filter((label) => !remove.has(label.toLocaleLowerCase())), ...add.filter((label) => !each.labels.includes(label))] }))
    }
    case 'builtin/relate':
    case 'builtin/unrelate': {
      const adding = name === 'builtin/relate'
      if (body.kind === 'relates') {
        if (adding) related.add(pair(task, other))
        else related.delete(pair(task, other))
        return { state: { ...state }, result: null }
      }
      // `task` blocks `other`: the fake keeps it as `other` blocked by `task`.
      return change((each) => ({ ...each, blockedBy: adding ? [...each.blockedBy, task] : each.blockedBy.filter((id) => id !== task) }), other)
    }
    case 'builtin/create': {
      const parent = typeof body.parent === 'string' ? body.parent : null
      const template = state.tasks.find((each) => each.project === String(body.project)) ?? state.tasks[0]!
      const project = prefix(template.id)
      const number = Math.max(0, ...withParents(state).filter((each) => prefix(each.id) === project).map((each) => Number(each.id.split('-')[1]))) + 1
      const milestone = state.tasks.find((each) => each.milestone?.label === body.milestone)?.milestone ?? null
      const created: ProjectTask = {
        ...template,
        id: `${project}-${number}`,
        title: String(body.title),
        status: { name: 'Todo', category: 'ToDo' },
        parent,
        milestone,
        blockedBy: [],
        labels: [],
        runLabels: [],
        question: false,
        subtasks: 0,
        priority: 'none',
      }
      return { state: { ...state, tasks: [...state.tasks, created] }, result: { id: created.id } }
    }
    case 'builtin/delete':
      return {
        state: {
          ...state,
          tasks: state.tasks
            .filter((each) => each.id !== task)
            .map((each) => ({ ...each, parent: each.parent === task ? null : each.parent, blockedBy: each.blockedBy.filter((id) => id !== task) })),
        },
        result: null,
      }
    default:
      return { state, result: null }
  }
}

function fakeEdit(
  state: EvenKeelState,
  task: string,
  field: string,
  to: string | null,
  mode: string | null,
  change: (update: (each: ProjectTask) => ProjectTask) => Answer,
): Answer {
  if (field === 'title' && mode === 'conflict' && !conflicted) {
    conflicted = true
    const theirs = 'Порядок задач по связям blocks и вехам'
    return { ...change((each) => ({ ...each, title: theirs })), refusal: fail('builtin.conflict', { task, field: 'title', current: theirs }) }
  }
  switch (field) {
    case 'title':
      return change((each) => ({ ...each, title: to ?? each.title }))
    case 'status': {
      const status = BUILTIN_STATUSES.find((each) => each.name === to)
      return change((each) => ({ ...each, status: status ?? each.status }))
    }
    case 'priority':
      return change((each) => ({ ...each, priority: (to ?? 'none') as TaskPriority }))
    case 'milestone': {
      const known = state.tasks.find((each) => each.milestone?.label === to)?.milestone
      return change((each) => ({ ...each, milestone: to === null ? null : (known ?? { label: to, targetDate: null }) }))
    }
    case 'parent':
      return change((each) => ({ ...each, parent: to }))
    default:
      return { state, result: null }
  }
}
