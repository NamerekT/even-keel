import type { StatusCategory } from '../../../src/tracker/model.js'

/**
 * A task status: an icon by its category, the tracker's own name in the tooltip. Statuses in progress stay a word:
 * "In Progress" and "In Review" share the category, and the word is what tells them apart.
 */
export function TaskStatus({ name, stage }: { name: string; stage: StatusCategory | null }) {
  if (stage === null || stage === 'Active') return <span className="status">{name}</span>
  return (
    <span className={`status status--${stage}`} role="img" aria-label={name} title={name}>
      <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6.25" />
        {stage === 'Won' && <path d="m5.3 8.2 1.9 1.9 3.6-3.8" />}
        {stage === 'Lost' && <path d="m5.9 5.9 4.2 4.2m0-4.2-4.2 4.2" />}
      </svg>
    </span>
  )
}

export function QuestionIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" />
      <path d="M6.2 6.4a1.9 1.9 0 1 1 2.7 1.7c-.6.3-.9.7-.9 1.3" />
      <path d="M8 11.6v.01" />
    </svg>
  )
}

export function StackIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.5 14 5.5 8 8.5 2 5.5z" />
      <path d="M2 8.25 8 11.25l6-3" />
      <path d="M2 11 8 14l6-3" />
    </svg>
  )
}
