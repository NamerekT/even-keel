import { Link } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import { projectLabel } from '../state.js'
import { ProjectLinks } from '../ui/ProjectLinks.js'
import { placePath } from './eventLog.js'
import type { EventSubject as Subject } from './eventLogFilter.js'
import type { ToastText } from './eventToast.js'

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

/** A toast's title (`toastOf`): the subject first, since a toast reads alone, then what happened. */
export function EventTitle({ text, state }: { text: Pick<ToastText, 'subject' | 'title'>; state: Known }) {
  if (text.subject === null) return <ProjectLinks text={text.title} />
  return (
    <>
      <EventSubject subject={text.subject} state={state} />: <ProjectLinks text={text.title} />
    </>
  )
}
