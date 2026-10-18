import { byNumber } from '../chain/order.js'
import type { MilestoneTask } from '../tracker/source.js'

/** A closing comment longer than this goes into the prompt cut: the gist of a task is in its first lines. */
export const MAX_COMMENT_CHARS = 2_000

/** What a changelog draft of a milestone is written from. */
export interface ChangelogMaterial {
  milestone: string
  /** The milestone's tasks closed as done, by number. */
  done: MilestoneTask[]
  /** How many of its tasks are still open: the draft does not cover them. */
  open: number
}

export function materialOf(milestone: string, tasks: MilestoneTask[]): ChangelogMaterial {
  return {
    milestone,
    done: tasks.filter((task) => task.status.category === 'Won').sort((a, b) => byNumber(a.id, b.id)),
    open: tasks.filter((task) => task.status.category !== 'Won' && task.status.category !== 'Lost').length,
  }
}

/**
 * What the turn does with the milestone's section: `fresh` — writes it from the tasks; `update` — works the tasks into
 * the section as it is; `edit` — changes the section as the user's instruction says, without tasks.
 */
export type ChangelogMode = 'fresh' | 'update' | 'edit'

export interface ChangelogRequest {
  milestone: string
  mode: ChangelogMode
  /** The section to start from; `null` for `fresh`. */
  section: string | null
  /** The heading of the section the answer starts with. */
  heading: string
  /** The tasks to write from (`fresh`) or to work in (`update`); unused by `edit`. */
  tasks: MilestoneTask[]
  /** The milestone's sections of tagged versions: released, what they describe is not repeated. */
  released: string[]
  /** The repository's tags, for reference. */
  tags: string[]
  /** The user's words, for `edit`. */
  instruction?: string
  /** The changelog file, relative to the repository's root. */
  file: string
}

/**
 * The prompt of the one read-only turn that writes the milestone's section in the project's main checkout. The agent
 * settles the language from the project's own files: the tasks may be written in another one than the public documentation.
 * It asks nothing: the turn has no one to answer it.
 */
export function changelogPrompt(request: ChangelogRequest): string {
  const { milestone, file, heading } = request
  const task = {
    fresh: `Write the changelog section of milestone ${milestone} of this repository from its finished tasks listed below.`,
    update: `Bring the changelog section of milestone ${milestone} of this repository up to date with the finished tasks listed below.`,
    edit: `Change the changelog section of milestone ${milestone} of this repository as the user asks below.`,
  }[request.mode]
  const rules = [
    `- Format: Keep a Changelog (https://keepachangelog.com/en/1.1.0/). The heading \`${heading}\`, then the groups Added, Changed, Deprecated, Removed, Fixed, Security — only those that have entries.`,
    '- One entry per change a user of the project would notice. Merge the tasks of one change; leave out the tasks a user would not notice (refactoring, tests, the project\'s own process).',
    `- Language: the one \`${file}\` in this folder is written in; without it, the one of README.md. Not the language of the tasks, if that differs.`,
    '- Read files only to settle the language and how the project names things. Change nothing.',
    '- Ask no questions: no one will answer them. Take an ambiguous request in the sense closest to the user\'s words and apply it.',
    `- Answer with the section alone, in Markdown, starting with its heading \`${heading}\`, without a preamble.`,
  ]
  if (request.mode === 'update') {
    rules.push(
      '- Keep the section\'s heading and its wording: work each task into an entry of its change or add a new entry. Change nothing else.',
      '- A task the section already describes needs nothing.',
    )
  }
  if (request.mode === 'edit') rules.push('- Change only what the user asks; keep the rest as it is.')
  const blocks = [task, '', ...rules]
  if (request.tags.length > 0) blocks.push('', `Tags of the repository: ${request.tags.join(', ')}.`)
  for (const released of request.released) {
    blocks.push('', '## Already released — leave out what this section describes', '', released.trim())
  }
  if (request.section !== null) blocks.push('', '## The section now', '', request.section.trim())
  if (request.mode === 'edit') blocks.push('', '## What the user asks', '', (request.instruction ?? '').trim())
  else blocks.push('', `## The tasks of ${milestone}`, '', ...request.tasks.map(taskBlock))
  return blocks.join('\n')
}

function taskBlock(task: MilestoneTask): string {
  const facts = [...(task.labels.length === 0 ? [] : [`Labels: ${task.labels.join(', ')}`]), ...(task.parent === null ? [] : [`Subtask of ${task.parent}`])]
  const comment = task.lastComment?.trim() || '(no comment)'
  const cut = comment.length > MAX_COMMENT_CHARS ? `${comment.slice(0, MAX_COMMENT_CHARS)}…` : comment
  return [`### ${task.id} · ${task.title}`, ...facts, '', cut, ''].join('\n')
}
