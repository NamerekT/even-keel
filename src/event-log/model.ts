import type { Notice } from '../notice/notice.js'

/** Information — launches, stops, settings; a warning — what waits for a person; an error — what holds a chain. */
export type EventLevel = 'info' | 'warning' | 'error'

/** Where "Open" of an entry leads; `null` — nowhere but the log. Only types here: the page imports it. */
export type EventPlace =
  | { view: 'project'; project: string }
  | { view: 'ci'; project: string }
  | { view: 'backlog'; project: string }
  | { view: 'task'; project: string; task: string }
  | { view: 'ask'; project: string | null; task: string }
  | { view: 'settings'; project: string | null }

/** An entry of the event log (BTN-350): written by the service, also while no page is open. */
export interface EventEntry {
  /** A number one above the last entry's, as a string: the state's keyed part names entries by it. */
  id: string
  at: string
  level: EventLevel
  notice: Notice
  place: EventPlace | null
}

export type EventDraft = Omit<EventEntry, 'id' | 'at'>
