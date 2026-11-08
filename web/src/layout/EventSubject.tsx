import { Link } from 'react-router'
import type { EventEntry } from '../../../src/event-log/model.js'
import type { EvenKeelState } from '../../../src/state.js'
import { projectLabel } from '../state.js'
import { Said } from '../ui/ProjectLinks.js'
import { placePath } from './eventLog.js'
import { subjectOf, type EventSubject as Subject } from './eventLogFilter.js'

type Known = Pick<EvenKeelState, 'ci' | 'projects' | 'projectLabels'>

/**
 * What an entry is about (`subjectOf`): a task number links to the task, a project key to the project, both the same
 * underlined link; a project no longer known is its key alone.
 */
export function EventSubject({ subject, state }: { subject: Subject; state: Known }) {
  if ('key' in subject) return subject.key
  const name = 'task' in subject ? subject.task : projectLabel(state, subject.project)
  const path = 'task' in subject
    ? subject.project === null ? null : placePath({ view: 'task', project: subject.project, task: subject.task }, state)
    : placePath({ view: 'project', project: subject.project }, state)
  return path === null ? name : <Link to={path} className="project-link">{name}</Link>
}

/** An entry's text as it reads alone, in a toast: its subject first, then the text the log shows next to it. */
export function EventTitle({ entry, state }: { entry: EventEntry; state: Known }) {
  const subject = subjectOf(entry)
  if (subject === null) return <Said notice={entry.notice} />
  return (
    <>
      <EventSubject subject={subject} state={state} />: <Said notice={entry.notice} />
    </>
  )
}
