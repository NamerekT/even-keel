import { notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'

export function withTrustPause(state: EvenKeelState | null, params: URLSearchParams, asService: boolean): void {
  const active = state?.chain.active[0]
  if (params.get('chain') !== 'untrusted' || !active || state === null) return
  const error = notice('claude.untrusted', { task: 'ABC-5', folder: 'D:/work/abc', platform: 'win32', user: 'evenkeel', service: asService })
  state.chain.active = [{ ...active, current: null, paused: true, error }]
}
