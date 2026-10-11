export function HandoffIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="2.8" cy="8" r="1.6" />
      <circle cx="13.2" cy="8" r="1.6" />
      <path d="M5.2 8h5.4M8.6 5.8 10.8 8l-2.2 2.2" />
    </svg>
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

export function LockIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="7.25" width="10" height="7" rx="1.5" />
      <path d="M5.25 7.25V5a2.75 2.75 0 0 1 5.5 0v2.25" />
    </svg>
  )
}

export function KeyIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="4.75" cy="8" r="3" />
      <path d="M7.75 8h6.5M11.5 8v2.75M14.25 8v2.25" />
    </svg>
  )
}

export function FlagIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 14.5V2.5" />
      <path d="M3.5 3h8.5l-2 3 2 3H3.5" />
    </svg>
  )
}

/** Into the chain, which stands to the left of the backlog. */
export function IntoChainIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 2.5v11" />
      <path d="M13.5 8H5.5M8.75 4.75 5.5 8l3.25 3.25" />
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

/** Settings: two sliders. */
export function SlidersIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 4.5h6M11 4.5h3M2 11.5h2M7 11.5h7" />
      <circle cx="9.5" cy="4.5" r="1.5" />
      <circle cx="5.5" cy="11.5" r="1.5" />
    </svg>
  )
}

/** The chain queue: the first in line is playing, the rest wait under it. */
export function QueueIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 2.75v3.5L5.5 4.5z" />
      <path d="M8 4.5h5.5M2.5 8.5h11M2.5 12.5h11" />
    </svg>
  )
}
