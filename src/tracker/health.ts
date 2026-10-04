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
  health: TrackerHealth
}

export const worthBroadcast = (before: TrackerHealth, after: TrackerHealth): boolean =>
  before.state !== after.state || before.error !== after.error || before.lastOkAt === null
