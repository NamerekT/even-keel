import { notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'

export function withTrustPause(state: EvenKeelState | null, params: URLSearchParams, asService: boolean): void {
  const active = state?.chain.active[0]
  if (!['untrusted', 'untrustedLong', 'trustWriteFailed'].includes(params.get('chain') ?? '') || !active || state === null) return
  const platform = state.platform
  const folder = params.get('chain') === 'untrustedLong' ? 'D:/work/a very long checkout folder for a project with a long name/example'
    : platform === 'win32' ? 'D:/work/abc' : '/work/abc'
  const error = params.get('chain') === 'trustWriteFailed' ? notice('claude.trustWriteFailed', { folder })
    : notice('claude.untrusted', { task: 'ABC-5', folder, platform, user: 'evenkeel', service: asService })
  state.chain.active = [{ ...active, current: null, paused: true, error }]
}
