export type TrackerLinkState = 'off' | 'connecting' | 'live' | 'down'

export interface TrackerHealth {
  state: TrackerLinkState
  lastOkAt: string | null
  error: string | null
}

export interface TrackerView {
  name: string
  title: string
  projects: string[]
  /** The connected adapter can move a backlog task to `ToDo`. */
  ready: boolean
  health: TrackerHealth
  /** When each project's tasks were last read in full, by project key; a project not read yet has none. */
  readAt: Record<string, string>
}

export const worthBroadcast = (before: TrackerHealth, after: TrackerHealth): boolean =>
  before.state !== after.state || before.error !== after.error || before.lastOkAt === null
