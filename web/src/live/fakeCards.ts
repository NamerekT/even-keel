import { fail } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'
import type { CardLabel, TaskCard, TaskRef } from '../../../src/tracker/card.js'
import type { Task } from '../../../src/tracker/model.js'

const DESCRIPTION = `## Goal

The page shows the task in full, so that nobody has to open the tracker on a phone.

- the description, rendered from Markdown;
- labels, links to other tasks, the milestone and the priority;
- comments, oldest first.

| Field | Where from |
| --- | --- |
| \`description\` | the tracker |
| \`labels\` | the tracker and the chain rules |

Done when \`npm test\` is green — see [the docs](https://example.com/docs).`

const COMMENTS = [
  { author: 'John Doe', text: 'Should the card also show **estimates**? Not now — later, if it is missed.' },
  { author: null, text: 'Checked on a narrow screen:\n\n```\nnpm run dev:fake\n```' },
]

/** `mode`: `empty` — a task without description, labels, links and comments; `none` — the tracker gives no card. */
export function fakeCard(state: EvenKeelState, id: string, mode: string | null): TaskCard | null {
  if (mode === 'none') return null
  const task = state.tasks.find((each) => each.id === id)
  if (task === undefined) return null
  const number = Number(id.split('-')[1])
  const refs = (ids: string[]): TaskRef[] =>
    ids.flatMap((other) => {
      const found = state.tasks.find((each) => each.id === other)
      return found === undefined ? [] : [{ id: found.id, title: found.title, status: found.status }]
    })
  const plain = mode === 'empty'
  const labels: CardLabel[] = plain
    ? []
    : [
        ...(task.question ? [{ name: 'Вопрос', role: 'question' as const }] : []),
        ...(number % 2 === 0 ? [{ name: 'Opus', role: 'model' as const }] : []),
        { name: 'UI', role: null },
      ]
  return {
    id,
    title: task.title,
    description: plain ? '' : DESCRIPTION,
    status: task.status,
    priority: plain ? 'none' : (['urgent', 'high', 'medium', 'low'] as const)[number % 4]!,
    labels,
    milestone: task.milestone,
    parent: null,
    blockedBy: refs(task.blockedBy),
    blocks: refs(state.tasks.filter((each) => each.blockedBy.includes(id)).map((each) => each.id)),
    related: plain ? [] : refs(state.tasks.filter((each) => each.id !== id && each.id.startsWith(id.split('-')[0]!)).slice(0, 1).map((each) => each.id)),
    comments: plain ? [] : COMMENTS.map((comment, index) => ({ ...comment, at: Date.now() - (COMMENTS.length - index) * 3_600_000 })),
    ready: task.status.category === 'UnStarted',
    requires: [],
  }
}

export function fakeReady(state: EvenKeelState, id: string): EvenKeelState {
  const task = state.tasks.find((each) => each.id === id)
  if (task === undefined || task.status.category !== 'UnStarted') throw fail('task.pastBacklog', { task: id })
  const project = id.split('-')[0]!
  const order = state.chain.projects[project]
  const tasks: Task[] = state.tasks.map((each) => (each.id === id ? { ...each, status: { name: 'Todo', category: 'ToDo' } } : each))
  if (order === undefined) return { ...state, tasks }
  const { [id]: before = null, ...landing } = order.landing ?? {}
  const at = before === null ? -1 : order.order.indexOf(before)
  const placed = at < 0 ? [...order.order, id] : [...order.order.slice(0, at), id, ...order.order.slice(at)]
  const projects = {
    ...state.chain.projects,
    [project]: { ...order, order: placed, backlog: order.backlog.filter((each) => each !== id), landing },
  }
  return { ...state, tasks, chain: { ...state.chain, projects } }
}
