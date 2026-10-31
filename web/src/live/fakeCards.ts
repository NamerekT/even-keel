import { compareMilestones } from '../../../src/chain/order.js'
import { fail } from '../../../src/notice/notice.js'
import type { EvenKeelState, ProjectTask } from '../../../src/state.js'
import type { CardLabel, TaskCard, TaskRef } from '../../../src/tracker/card.js'
import { runLabelOf, type MilestoneChoice, type TaskMilestone } from '../../../src/tracker/model.js'

const DESCRIPTION = `## Goal

The page shows the task in full, so that nobody has to open the tracker on a phone.

- the description, rendered from Markdown;
- labels, links to other tasks, the milestone and the priority;
- comments, oldest first.

| Field | Where from |
| --- | --- |
| \`description\` | the tracker |
| \`labels\` | the tracker and the chain rules |

Huly writes its tables as HTML:

<table><tbody><tr><th><p>Tracker</p></th><th><p>Tables</p></th></tr><tr><td><p>Huly</p></td><td><p>HTML</p></td></tr><tr><td><p>GitHub, Linear</p></td><td><p>Markdown</p></td></tr></tbody></table>

1. **Ordered items** keep their numbers.
2. A link to [ABC-2](tracker://ABC-2) opens its card.

Done when \`npm test\` is green — see [the docs](https://example.com/docs).`

const COMMENTS = [
  { author: 'John Doe', text: 'Should the card also show **estimates**? Not now — later, if it is missed.' },
  { author: null, text: 'Checked on a narrow screen:\n\n```\nnpm run dev:fake\n```' },
]

export const picture = (width: number, height: number, from: string, to: string, text: string): string =>
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
      `<rect width="100%" height="100%" fill="url(#g)"/>` +
      `<text x="50%" y="50%" fill="#fff" font-family="sans-serif" font-size="${Math.round(width / 12)}" text-anchor="middle" dominant-baseline="middle">${text}</text></svg>`,
  )

const ATTACHMENTS: TaskCard['attachments'] = [
  { file: 'screen-desktop.svg', name: 'screen-desktop.svg', type: 'image/svg+xml', size: 2_400, url: picture(1600, 900, '#2f5fd0', '#1baf7a', '1600 × 900') },
  { file: 'screen-phone.svg', name: 'screen-phone.svg', type: 'image/svg+xml', size: 1_900, url: picture(390, 844, '#eb6834', '#d2443a', '390 × 844') },
  { file: 'diagram.svg', name: 'chain-order-diagram-with-a-long-name.svg', type: 'image/svg+xml', size: 1_200, url: picture(800, 800, '#6b4fd0', '#2a78d6', '800 × 800') },
  { file: 'flower.webm', name: 'flower.webm', type: 'video/webm', size: 554_058, url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm' },
  { file: 'notes.txt', name: 'notes.txt', type: 'text/plain', size: 32, url: 'data:text/plain;charset=utf-8,' + encodeURIComponent('Notes from the call, nothing more.\n') },
]

/** `mode`: `empty` — a task without description, labels, links, comments and attachments; `none` — the tracker gives no card. */
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
        ...task.labels.map((name) => ({ name, role: runLabelOf(name) === null ? null : 'model' as const })),
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
    attachments: plain ? [] : ATTACHMENTS,
    ready: task.status.category === 'UnStarted',
    unready: task.status.category === 'ToDo' || task.status.category === 'Active',
    requires: [],
    milestones: { current: task.milestone?.label ?? null, choices: fakeMilestones(state, id) },
  }
}

/** The fake's milestones are those its tasks of the project have, each by its label. */
function fakeMilestones(state: EvenKeelState, id: string): MilestoneChoice[] {
  const project = id.split('-')[0]!
  const found = new Map<string, TaskMilestone>()
  for (const task of state.tasks) if (task.id.startsWith(`${project}-`) && task.milestone !== null) found.set(task.milestone.label, task.milestone)
  return [...found.values()].sort(compareMilestones).map((milestone) => ({ id: milestone.label, ...milestone }))
}

export function fakeMoveMilestone(state: EvenKeelState, id: string, milestone: string | null): EvenKeelState {
  const project = id.split('-')[0]!
  const target = milestone === null ? null : (state.tasks.find((task) => task.id.startsWith(`${project}-`) && task.milestone?.label === milestone)?.milestone ?? null)
  return { ...state, tasks: state.tasks.map((task) => (task.id === id ? { ...task, milestone: target } : task)) }
}

export function fakeReady(state: EvenKeelState, id: string): EvenKeelState {
  const task = state.tasks.find((each) => each.id === id)
  if (task === undefined || task.status.category !== 'UnStarted') throw fail('task.pastBacklog', { task: id })
  const project = id.split('-')[0]!
  const order = state.chain.projects[project]
  const tasks: ProjectTask[] = state.tasks.map((each) => (each.id === id ? {
    ...each,
    status: { name: 'Todo', category: 'ToDo' },
    milestone: order?.landingMilestones?.[id] ?? each.milestone,
  } : each))
  if (order === undefined) return { ...state, tasks }
  const { [id]: before = null, ...landing } = order.landing ?? {}
  const { [id]: filled, ...landingMilestones } = order.landingMilestones ?? {}
  const at = before === null ? -1 : order.order.indexOf(before)
  const placed = at < 0 ? [...order.order, id] : [...order.order.slice(0, at), id, ...order.order.slice(at)]
  const projects = {
    ...state.chain.projects,
    [project]: { ...order, order: placed, waiting: order.waiting.filter((each) => each !== id), backlog: order.backlog.filter((each) => each !== id), landing, landingMilestones },
  }
  return { ...state, tasks, chain: { ...state.chain, projects } }
}

export function fakeUnready(state: EvenKeelState, id: string): EvenKeelState {
  const task = state.tasks.find((each) => each.id === id)
  if (task === undefined || (task.status.category !== 'ToDo' && task.status.category !== 'Active')) throw fail('task.inBacklog', { task: id })
  const project = id.split('-')[0]!
  const order = state.chain.projects[project]
  const tasks: ProjectTask[] = state.tasks.map((each) => (each.id === id ? { ...each, status: { name: 'Backlog', category: 'UnStarted' } } : each))
  if (order === undefined) return { ...state, tasks }
  const projects = { ...state.chain.projects, [project]: { ...order, order: order.order.filter((each) => each !== id), backlog: [...order.backlog, id] } }
  return { ...state, tasks, chain: { ...state.chain, projects } }
}
