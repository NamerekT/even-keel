import type { Notice } from '../../../src/notice/notice.js'

/** The tasks a reason of a held switch names (BTN-1459): each one is dealt with on its card, its session in the drawer. */
export function heldTasksOf(item: Notice): string[] {
  if (item.code === 'switch.current') return [item.params.task]
  if (item.code === 'switch.released' || item.code === 'switch.reviews') return item.params.tasks
  return []
}

export type TextPart = { text: string; task?: string }

/** The reason's text cut at each id of `tasks`, so the page links the ids in place; `ABC-1` is not found inside `ABC-12`. */
export function taskParts(text: string, tasks: readonly string[]): TextPart[] {
  if (tasks.length === 0) return [{ text }]
  const ids = [...new Set(tasks)].sort((a, b) => b.length - a.length).map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const found = new RegExp(`(?<![\\w-])(${ids.join('|')})(?![\\w-])`, 'g')
  const parts: TextPart[] = []
  let at = 0
  for (const match of text.matchAll(found)) {
    if (match.index > at) parts.push({ text: text.slice(at, match.index) })
    parts.push({ text: match[0], task: match[0] })
    at = match.index + match[0].length
  }
  if (at < text.length) parts.push({ text: text.slice(at) })
  return parts
}
