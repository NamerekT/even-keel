export type HulyLinkState = 'off' | 'connecting' | 'live' | 'down'

export interface HulyHealth {
  state: HulyLinkState
  lastOkAt: string | null
  error: string | null
}

export const worthBroadcast = (before: HulyHealth, after: HulyHealth): boolean =>
  before.state !== after.state || before.error !== after.error || before.lastOkAt === null
