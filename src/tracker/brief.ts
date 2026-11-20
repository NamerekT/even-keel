import type { BriefAncestor, TaskBrief, TaskSource } from './source.js'

/** Parents read at most: a deeper tree is a loop the tracker let through, not a frame. */
const MAX_ANCESTORS = 10

/**
 * The task's brief with its parents root first (BTN-1398): a child's description holds only its part, the frame is in
 * the parents. An ancestor whose brief gives no files but whose card has attachments is marked `attached`.
 * The walk stops at a parent the tracker no longer has. Called only for a source that has `brief`.
 */
export async function briefWithAncestors(source: TaskSource, id: string): Promise<TaskBrief> {
  const own = await source.brief!(id)
  const seen = new Set([id.toUpperCase()])
  const ancestors: BriefAncestor[] = []
  let [task] = await source.tasks([id])
  while (task?.parent !== null && task?.parent !== undefined && !seen.has(task.parent.toUpperCase()) && ancestors.length < MAX_ANCESTORS) {
    const parent = task.parent
    seen.add(parent.toUpperCase())
    ;[task] = await source.tasks([parent])
    if (task === undefined) break
    const { ancestors: _nested, ...brief } = await source.brief!(parent)
    const attached = (brief.files ?? []).length === 0 && source.card !== undefined && (await source.card(parent)).attachments.length > 0
    ancestors.push({ id: parent, ...brief, ...(attached ? { attached: true } : {}) })
  }
  return ancestors.length === 0 ? own : { ...own, ancestors: ancestors.reverse() }
}
