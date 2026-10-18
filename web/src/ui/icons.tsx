import type { ReactNode } from 'react'

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

/** Save: a check mark. */
export function CheckIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  )
}

/** A list that opens downwards: a chevron. */
export function ChevronIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4 6 4 4 4-4" />
    </svg>
  )
}

/** Back as it was: an arrow turning back. */
export function UndoIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5.5 3 2.5 6l3 3" />
      <path d="M2.5 6h7a4 4 0 0 1 0 8H7" />
    </svg>
  )
}

/** Read anew: a circular arrow. */
export function RefreshIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13 8a5 5 0 1 1-1.5-3.55" />
      <path d="M12 1.5V5H8.5" />
    </svg>
  )
}

/** Send a message: an arrow up. */
export function SendIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 13V3M3.75 7.25 8 3l4.25 4.25" />
    </svg>
  )
}

/** Add a row: a plus. */
export function PlusIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  )
}

/** Remove a row: a bin. */
export function TrashIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4.25h11M6.25 4.25V2.75h3.5v1.5M4 4.25l.75 9.25h6.5L12 4.25" />
    </svg>
  )
}

/** The groups of a page: three lines. */
export function MenuIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
    </svg>
  )
}

/** Claude Code: a burst of rays. */
export function ClaudeIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.75v12.5M1.75 8h12.5M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8" />
    </svg>
  )
}

/** Codex: a hexagon with a prompt in it. */
export function CodexIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.5 13.75 4.75v6.5L8 14.5 2.25 11.25v-6.5Z" />
      <path d="M5.75 6.5 7.5 8l-1.75 1.5M8.75 10h1.75" />
    </svg>
  )
}

/** Even Keel itself: the sail and the keel of its logo, drawn in lines. */
export function EvenKeelIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8.5 1.75v6h4.25ZM7 3.5v4.25H3.75ZM1.75 9.25h12.5l-1.75 2.5h-9ZM7.25 11.75h1.5L8 14.25Z" />
    </svg>
  )
}

/** A code editor app such as VS Code: a window with a side bar and lines of code — not the app's own trademarked logo. */
export function EditorIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.75" y="2.5" width="12.5" height="11" rx="1.5" />
      <path d="M5.25 2.5v11M7.75 6h4M7.75 8.25h2.75M7.75 10.5h3.5" />
    </svg>
  )
}

/** Signed in through the agent's CLI: a terminal. */
export function TerminalIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.75" y="3" width="12.5" height="10" rx="1.5" />
      <path d="M4.5 6.25 6.5 8l-2 1.75M8 10h3.5" />
    </svg>
  )
}

/** Through the Agent SDK: braces. */
export function BracesIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 2.75c-1.5 0-1.75.75-1.75 2v1.5c0 1-.5 1.75-1.5 1.75 1 0 1.5.75 1.5 1.75v1.5c0 1.25.25 2 1.75 2" />
      <path d="M10 2.75c1.5 0 1.75.75 1.75 2v1.5c0 1 .5 1.75 1.5 1.75-1 0-1.5.75-1.5 1.75v1.5c0 1.25-.25 2-1.75 2" />
    </svg>
  )
}

/** A plugin package: a plug. */
export function PlugIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 1.75v3M10 1.75v3" />
      <path d="M3.75 4.75h8.5v2.5a4.25 4.25 0 0 1-8.5 0z" />
      <path d="M8 11.5v2.75" />
    </svg>
  )
}

/** An MCP server package: a rack of two units. */
export function ServerIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2.25" width="12" height="5" rx="1.25" />
      <rect x="2" y="8.75" width="12" height="5" rx="1.25" />
      <path d="M4.75 4.75h.01M4.75 11.25h.01M8 4.75h3.25M8 11.25h3.25" />
    </svg>
  )
}

const TRACKER_ICONS: Record<string, () => ReactNode> = { huly: BoardsIcon, github: BranchIcon, linear: ChecklistIcon, forgejo: PipelineIcon }

/** A profile's own icon by its kind, a tracker's or a CI's; a key for a kind without one. */
export function TrackerIcon({ kind }: { kind: string }) {
  const Icon = TRACKER_ICONS[kind] ?? KeyIcon
  return <Icon />
}

/** A Forgejo profile: a CI run of three jobs, the last one passed, not Forgejo's mark. */
export function PipelineIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3" cy="8" r="1.75" />
      <circle cx="8" cy="8" r="1.75" />
      <circle cx="13" cy="8" r="2.25" />
      <path d="M4.75 8h1.5M9.75 8h1M12 8l.75.75L14 7.25" />
    </svg>
  )
}

/** A Huly profile: four boards of a workspace, not Huly's mark. */
export function BoardsIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2" width="5.25" height="5.25" rx="1.25" />
      <rect x="8.75" y="2" width="5.25" height="5.25" rx="1.25" />
      <rect x="2" y="8.75" width="5.25" height="5.25" rx="1.25" />
      <rect x="8.75" y="8.75" width="5.25" height="5.25" rx="1.25" />
    </svg>
  )
}

/** A GitHub profile: a branch that forks off and back, not GitHub's mark. */
export function BranchIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="4.5" cy="3.25" r="1.5" />
      <circle cx="4.5" cy="12.75" r="1.5" />
      <circle cx="11.5" cy="5.25" r="1.5" />
      <path d="M4.5 4.75v6.5M11.5 6.75c0 2.5-2 3.25-4.5 3.75-1.25.25-2.25.75-2.5 1" />
    </svg>
  )
}

/** A Linear profile: a checklist, not Linear's mark. */
export function ChecklistIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="m2.25 4 1.25 1.25L5.75 3M2.25 9.5l1.25 1.25L5.75 8.5M8 4.25h5.75M8 9.75h5.75M8 13.25h3.5" />
    </svg>
  )
}
