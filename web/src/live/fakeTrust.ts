import { notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'

export function withTrustPause(state: EvenKeelState | null, params: URLSearchParams, asService: boolean): void {
  const active = state?.chain.active[0]
  if (!['untrusted', 'untrustedLong', 'untrustedLegacy', 'untrustedGlobal', 'trustWriteFailed'].includes(params.get('chain') ?? '') || !active || state === null) return
  const platform = state.platform
  const folder = params.get('chain') === 'untrustedLong' ? 'D:/work/a very long checkout folder for a project with a long name/example'
    : platform === 'win32' ? 'D:/work/abc' : '/work/abc'
  const recovery = params.get('chain') === 'untrustedLegacy' ? undefined : {
    binary: platform === 'win32' ? 'D:/Even Keel/cli/claude/checked/claude.exe' : '/opt/even-keel/cli/claude/checked/claude',
    configDir: params.get('chain') === 'untrustedGlobal' ? null : platform === 'win32' ? 'D:/accounts/claude/example' : '/home/example/.claude-accounts/example',
  }
  const accountFile = platform === 'win32' ? 'D:/accounts/claude/example/.claude.json' : '/home/example/.claude-accounts/example/.claude.json'
  // A Windows service's refusal names the script its runas command opens (EKR-87).
  const script = asService && platform === 'win32' && recovery !== undefined ? { script: 'D:\\even-keel\\state\\trust\\ABC-5.ps1' } : {}
  const error = params.get('chain') === 'trustWriteFailed' ? notice('claude.trustWriteFailed', { folder, file: accountFile, reason: 'access' })
    : notice('claude.untrusted', { task: 'ABC-5', folder, platform, user: 'evenkeel', service: asService, recovery, ...script })
  state.chain.active = [{ ...active, current: null, paused: true, error }]
}
