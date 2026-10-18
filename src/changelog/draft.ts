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
 * The prompt of the one turn that writes the draft in the project's main checkout. The agent settles the language from
 * the project's own files: the tasks may be written in another one than the public documentation.
 */
export function changelogPrompt(material: ChangelogMaterial): string {
  const { milestone } = material
  return [
    `Write a draft of the changelog section of milestone ${milestone} of this repository, from its finished tasks listed below.`,
    '',
    `- Format: Keep a Changelog (https://keepachangelog.com/en/1.1.0/). A heading \`## [${milestone}]\`, then the groups Added, Changed, Deprecated, Removed, Fixed, Security — only those that have entries.`,
    '- One entry per change a user of the project would notice. Merge the tasks of one change; leave out the tasks a user would not notice (refactoring, tests, the project\'s own process).',
    '- Language: the one CHANGELOG.md in this folder is written in; without it, the one of README.md. Not the language of the tasks, if that differs.',
    '- Read files only to settle the language and how the project names things. Change nothing.',
    '- If CHANGELOG.md has an `Unreleased` section, after the draft add a line `---` and list, by id, the tasks whose change that section does not mention.',
    '- Answer with the draft alone, in Markdown, without a preamble.',
    '',
    `## The tasks of ${milestone}`,
    '',
    ...material.done.map(taskBlock),
  ].join('\n')
}

function taskBlock(task: MilestoneTask): string {
  const facts = [...(task.labels.length === 0 ? [] : [`Labels: ${task.labels.join(', ')}`]), ...(task.parent === null ? [] : [`Subtask of ${task.parent}`])]
  const comment = task.lastComment?.trim() || '(no comment)'
  const cut = comment.length > MAX_COMMENT_CHARS ? `${comment.slice(0, MAX_COMMENT_CHARS)}…` : comment
  return [`### ${task.id} · ${task.title}`, ...facts, '', cut, ''].join('\n')
}
