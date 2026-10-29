import { labelKey } from '../tracker/labels.js'
import type { TaskStatus } from '../tracker/model.js'
import type { TaskSource } from '../tracker/source.js'

const COMPACTION = 'Разрыв | компакция'
const HANDOFF = 'Разрыв | хендофф'
const BREAK_LABELS = new Set([COMPACTION, HANDOFF].map(labelKey))
const open = (status: TaskStatus) => status.category !== 'Won' && status.category !== 'Lost'

export function breakLabelOf(id: string, labels: string[]): { expected: string; actual: string[] } {
  const number = /-(\d+)$/.exec(id)?.[1]
  if (number === undefined) throw new Error(`No task number in ${id}`)
  return {
    expected: Number(number.at(-1)) % 2 === 0 ? COMPACTION : HANDOFF,
    actual: labels.filter((label) => BREAK_LABELS.has(labelKey(label))),
  }
}

export function selectProjects(keys: Record<string, string>, args: string[]): string[] {
  if (args.length === 0) throw new Error('Give at least one project key or GUID')
  return [...new Set(args.map((arg) => {
    if (Object.hasOwn(keys, arg)) return arg
    const ids = Object.keys(keys).filter((id) => keys[id] === arg)
    if (ids.length > 1) throw new Error(`Project key ${arg} is ambiguous; use a GUID: ${ids.join(', ')}`)
    if (ids.length === 0) throw new Error(`Unknown project ${arg}`)
    return ids[0]!
  }))]
}

export interface BreakAssignment {
  id: string
  number: string
  expected: string
  actual: string[]
  action: 'assigned' | 'existing' | 'preview' | 'skipped'
}

/** Reads every open task, including backlog and parents; preserves existing assignments even when they disagree. */
export async function assignBreakLabels(
  source: Pick<TaskSource, 'chainTasks' | 'tasks' | 'relabel'>,
  project: string,
  dryRun: boolean,
  log: (event: BreakAssignment) => void,
): Promise<void> {
  if (!dryRun && source.relabel === undefined) throw new Error('Tracker cannot write labels')
  const { tasks } = await source.chainTasks(project, open)
  for (const listed of tasks.filter((task) => open(task.status))) {
    // The list may be stale by the time the preceding tasks have been labelled.
    const [task] = await source.tasks([listed.id])
    const decision = breakLabelOf(listed.id, task?.labels ?? listed.labels)
    const event = { id: listed.id, number: /-(\d+)$/.exec(listed.id)![1]!, ...decision }
    if (task === undefined || !open(task.status)) {
      log({ ...event, action: 'skipped' })
    } else if (decision.actual.length > 0) {
      log({ ...event, action: 'existing' })
    } else if (dryRun) {
      log({ ...event, action: 'preview' })
    } else {
      const saved = await source.relabel!(task.id, { add: [decision.expected], remove: [] })
      log({ ...event, action: 'assigned', actual: saved.filter((label) => BREAK_LABELS.has(labelKey(label))) })
    }
  }
}
