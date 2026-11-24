import type { TrackerCard } from '../tracker/card.js'
import { groupChanges, type ChangeField, type TaskChange } from '../tracker/history.js'
import type { TaskRun } from '../sessions/runs.js'
import { runLine } from './run-machines.js'

const AUTHORS = { person: 'Person', agent: 'Agent', service: 'Even Keel' } as const

const WORDS: Record<ChangeField, string> = {
  created: 'created', moved: 'moved here from', title: 'title', status: 'status', priority: 'priority', milestone: 'milestone',
  component: 'component', parent: 'parent', description: 'description', estimate: 'estimate', run: 'run', label: 'label', blocks: 'blocks',
  blockedBy: 'blocked by', relates: 'relates', subtask: 'subtask',
}

const ONE_A_CHANGE: ReadonlySet<ChangeField> = new Set(['label', 'blocks', 'blockedBy', 'relates', 'subtask'])

/**
 * The task's change history as `task_read` gives it on request (BTN-1112): one author's close changes under one head,
 * a line a field. A description says only how many lines changed: the text itself is the description above.
 */
export function historyText(card: Pick<TrackerCard, 'history' | 'comments'>, names: (machine: string) => string = (id) => id): string {
  if (card.history === undefined) return "## History\n\nthis tracker keeps the history itself; it is not read here"
  const groups = groupChanges(card.history, card.comments.map((each) => each.at))
  if (groups.length === 0) return '## History\n\nnone'
  const blocks = groups.map((group) => {
    const who = `${group.name ?? AUTHORS[group.by]}${group.model === null ? '' : ` (${group.model})`}`
    return [`### ${who}, ${new Date(group.at).toISOString().slice(0, 16).replace('T', ' ')}`, ...group.changes.map((each) => `- ${changeLine(each, names)}`)].join('\n')
  })
  return `## History\n\n${blocks.join('\n\n')}`
}

function changeLine(change: TaskChange, names: (machine: string) => string): string {
  const word = WORDS[change.field]
  if (change.field === 'created') return word
  if (change.field === 'moved') return `${word} ${change.to ?? '?'}`
  if (change.field === 'description') {
    const count = (kind: 'added' | 'removed') => (change.diff ?? []).filter((line) => line.kind === kind).length
    return `${word} changed: +${count('added')} −${count('removed')} lines`
  }
  if (ONE_A_CHANGE.has(change.field)) return change.to !== null ? `${word} +${change.to}` : `${word} −${change.from ?? ''}`
  const value = (text: string | null) => (text === null ? 'none' : change.field === 'run' ? runText(text, names) : change.field === 'estimate' ? `${text} min` : text)
  return `${word} ${value(change.from)} → ${value(change.to)}`
}

function runText(json: string, names: (machine: string) => string): string {
  try {
    return runLine(JSON.parse(json) as TaskRun, names)
  } catch {
    return json
  }
}
