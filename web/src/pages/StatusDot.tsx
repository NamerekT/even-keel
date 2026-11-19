import type { TaskStatus } from '../../../src/tracker/model.js'
import './statusDot.css'

/** The dot of a status's category, as the task card shows it. */
export function StatusDot({ status }: { status: Pick<TaskStatus, 'category'> }) {
  return (
    <span className={`task-card__status task-card__status--${status.category} task-card__status--bare`}>
      <span className="task-card__dot" />
    </span>
  )
}
