import type { EventEntry } from '../../../src/event-log/model.js'
import type { Notice } from '../../../src/notice/notice.js'
import { labelled, sayIds, sayLines, t } from '../i18n/index.js'
import { projectOf, subjectOf, type EventSubject } from './eventLogFilter.js'

/** A toast's words: who it is about, what happened after it, and the smaller line under them. */
export interface ToastText {
  subject: EventSubject | null
  /** With its projects by their ids, for `ProjectLinks`. */
  title: string
  body: string | undefined
}

/**
 * An entry as its toast says it (BTN-1149). A chain paused on an error is told by the error, not by the pause around
 * it: the title is what happened — about the task when the error names one, else the project — and the body the causes
 * under it with the one thing to do; the pause's own hint is only for an error that has neither. Any other entry is its
 * text after its subject, with the hint of its code.
 */
export function toastOf(entry: EventEntry): ToastText {
  const error = entry.notice.code === 'eventLog.chainHeld' ? entry.notice.cause : undefined
  if (error === undefined) return { subject: subjectOf(entry), title: sayIds(entry.notice), body: t.events.hints[entry.notice.code] }
  const { head, under } = sayLines(error)
  const task = taskOf(error)
  return {
    subject: task === null ? subjectOf(entry) : { task, project: projectOf(entry) },
    title: (task === null ? undefined : t.events.titles[error.code]) ?? head,
    body: under === null ? t.events.hints[entry.notice.code] : labelled(under),
  }
}

function taskOf(notice: Notice): string | null {
  const task = (notice.params as { task?: unknown }).task
  if (typeof task === 'string') return task
  return notice.cause === undefined ? null : taskOf(notice.cause)
}
