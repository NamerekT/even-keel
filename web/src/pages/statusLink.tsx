import type { ReactNode } from 'react'
import type { EvenKeelState } from '../../../src/state.js'
import type { TrackerView } from '../../../src/tracker/health.js'
import { formatAgo } from '../format.js'
import { t } from '../i18n/index.js'
import { ProjectLabel } from '../ui/ProjectLabel.js'
import { Tipped } from '../ui/Tipped.js'

/**
 * The dot and word of a connection; when it last answered — the built-in tracker's open tasks (`open`) — is its tip,
 * never glued to the word with a `·` (BTN-1382).
 */
export function LinkState({ tracker, now, open }: { tracker: TrackerView; now: Date; open: number | null }) {
  const { health } = tracker
  const ago = health.lastOkAt === null ? null : formatAgo(health.lastOkAt, now)
  const [word, tail] =
    health.state === 'live' && open !== null
      ? [t.statusPage.builtinReady, tracker.projects.length === 0 ? null : t.statusPage.openTasks(open)]
      : health.state === 'live'
      ? [t.system.live, ago === null ? null : t.statusPage.polled(ago)]
      : health.state === 'down'
        ? [t.system.lost, ago === null ? t.statusPage.neverAnswered : t.statusPage.lastAnswer(ago)]
        : [health.state === 'connecting' ? t.system.connecting : t.system.off, null]
  const state = (
    <span className="status-connection__state">
      <span className="system__dot" aria-hidden="true" />
      {tail === null ? word : <span className="status-connection__word">{word}</span>}
    </span>
  )
  if (tail === null) return state
  return (
    <Tipped tip={tail} inline focusable>
      {state}
    </Tipped>
  )
}

/** A project or a task feed a connection reads: its name, and the line its tip says of it (a feed's project); `null` — none. */
export interface ReaderName {
  reader: string
  name: ReactNode
  about: string | null
}

/** A project by its label, a task feed by its key with its project in the tip; `null` for a reader of no known project, which is not shown by its id. */
export function readerName(state: EvenKeelState, reader: string, label: (project: string) => string): ReaderName | null {
  if (state.projects.includes(reader)) return { reader, name: <ProjectLabel project={reader} nameClass="status-reader__name" />, about: null }
  for (const [project, feeds] of Object.entries(state.config.feeds)) {
    const feed = feeds.find((each) => each.id === reader)
    if (feed !== undefined) return { reader, name: feed.key, about: t.statusPage.feedOf(label(project)) }
  }
  return null
}

/** A reader's tag; a stale one marked, with when it was last read (`read`, `null` — never) and why it is marked in its tip, a line each. */
export function Reader({ name, about, stale, read, now }: Omit<ReaderName, 'reader'> & { stale: boolean; read: string | null; now: Date }) {
  const className = stale ? 'tag status-reader status-reader--stale' : 'tag status-reader'
  const lines = [about, ...(stale ? [read === null ? t.statusPage.notRead : t.statusPage.readAgo(formatAgo(read, now)), t.statusPage.staleHint] : [])].filter(
    (line): line is string => line !== null,
  )
  if (lines.length === 0) return <li className={className}>{name}</li>
  return (
    <li className={className}>
      {stale && <span className="status-reader__mark" aria-hidden="true" />}
      <Tipped
        tip={lines.map((line) => (
          <span key={line} className="status-reader__line">
            {line}
          </span>
        ))}
        inline
        focusable
      >
        {name}
      </Tipped>
    </li>
  )
}
