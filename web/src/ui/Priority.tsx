import type { TaskPriority } from '../../../src/tracker/model.js'
import './priority.css'

export function PriorityIcon({ priority }: { priority: TaskPriority }) {
  if (priority === 'urgent') return <span className="priority__urgent" aria-hidden="true">!</span>
  const level = { none: 0, low: 1, medium: 2, high: 3 }[priority]
  return (
    <span className={`priority__bars priority__bars--${priority}`} aria-hidden="true">
      {[1, 2, 3].map((bar) => (
        <span key={bar} className={bar <= level ? 'priority__bar priority__bar--on' : 'priority__bar'} />
      ))}
    </span>
  )
}
