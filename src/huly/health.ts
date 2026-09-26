export type HulyLinkState = 'off' | 'connecting' | 'live' | 'down'

export interface HulyHealth {
  state: HulyLinkState
  lastOkAt: string | null
  error: string | null
}
