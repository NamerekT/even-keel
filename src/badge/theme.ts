/** The page's tokens (`web/src/styles.css`) the badge draws with, per theme. */
export interface BadgeTheme {
  bg: string
  surface: string
  surfaceMuted: string
  border: string
  fg: string
  fgMuted: string
  accent: string
  done: string
  working: string
  waiting: string
  idle: string
  warnBg: string
  warnFg: string
  /** The action bar of a Claude session; another agent's is `working`. */
  claude: string
  /** The action text of another agent's session; a Claude session's is `warnFg`. */
  otherFg: string
  /** The footer's small print. */
  faint: string
}

export const BADGE_THEMES: Record<'dark' | 'light', BadgeTheme> = {
  dark: {
    bg: '#141413',
    surface: '#1d1d1b',
    surfaceMuted: '#262624',
    border: '#34332f',
    fg: '#ecebe6',
    fgMuted: '#9a988f',
    accent: '#7ea2ff',
    done: '#47c075',
    working: '#5b92ff',
    waiting: '#f0bd3c',
    idle: '#6f6d66',
    warnBg: '#3a2f10',
    warnFg: '#f3d58a',
    claude: '#f0bd3c',
    otherFg: '#a9c0ff',
    faint: '#6f6d66',
  },
  light: {
    bg: '#f4f3ef',
    surface: '#ffffff',
    surfaceMuted: '#ecebe6',
    border: '#dddbd3',
    fg: '#1c1c1a',
    fgMuted: '#66645d',
    accent: '#2f5fd0',
    done: '#2e9d57',
    working: '#2f6fe0',
    waiting: '#d19a0f',
    idle: '#9a988f',
    warnBg: '#fbf0d0',
    warnFg: '#6a4b00',
    claude: '#d19a0f',
    otherFg: '#2f5fd0',
    faint: '#8a887f',
  },
}

const EDITS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'apply_patch', 'edit', 'write', 'patch'])
const READS = new Set(['Read', 'Grep', 'Glob', 'LS', 'read', 'grep', 'glob', 'list'])
const SHELLS = new Set(['Bash', 'PowerShell', 'shell', 'exec', 'exec_command', 'bash'])
const WEB = new Set(['WebFetch', 'WebSearch', 'web_search', 'webfetch', 'websearch'])

/** A 16×16 stroke icon of the agent, the page's own (`web/src/ui/icons.tsx`); an unknown agent gets a dot. */
export function agentIcon(agent: string): string {
  switch (agent.toLowerCase()) {
    case 'claude':
      return '<path d="M8 1.75v12.5M1.75 8h12.5M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8"/>'
    case 'codex':
      return '<path d="M8 1.5 13.75 4.75v6.5L8 14.5 2.25 11.25v-6.5Z"/><path d="M5.75 6.5 7.5 8l-1.75 1.5M8.75 10h1.75"/>'
    case 'opencode':
      return '<path d="M13.25 5.75v-3H2.75v10.5h10.5v-3"/><path d="M5.5 8h4.5"/>'
    case 'copilot':
      return '<circle cx="5" cy="8.5" r="2.75"/><circle cx="11" cy="8.5" r="2.75"/><path d="M7.75 8.5h0.5M1 7.5h1.25M13.75 7.5H15"/>'
    default:
      return '<circle cx="8" cy="8" r="2.5"/>'
  }
}

/** A 16×16 stroke clock: how long a task has run. */
export const CLOCK_ICON = '<circle cx="8" cy="8" r="6"/><path d="M8 4.75V8l2.25 1.5"/>'

/** A 16×16 stroke icon of the tool's kind, drawn in `currentColor`. */
export function toolIcon(tool: string): string {
  if (EDITS.has(tool)) return '<path d="M3 13l1-3.5L11 2.5l2.5 2.5L6.5 12z M9.5 4l2.5 2.5"/>'
  if (READS.has(tool)) return '<circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/>'
  if (SHELLS.has(tool)) return '<path d="M2.5 4l4 4-4 4 M8 12.5h5.5"/>'
  if (WEB.has(tool)) return '<circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11 M8 2.5c-3 3.5-3 7.5 0 11 M8 2.5c3 3.5 3 7.5 0 11"/>'
  return '<circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v2.5 M8 12v2.5 M1.5 8h2.5 M12 8h2.5"/>'
}
