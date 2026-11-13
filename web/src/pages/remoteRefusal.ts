import type { Notice } from '../../../src/notice/notice.js'

const REMOTE_CODES = new Set<Notice['code']>([
  'git.remoteShape',
  'git.remoteDenied',
  'git.remoteHostKey',
  'git.remoteSshKey',
  'git.remoteNotFound',
  'git.remoteNetwork',
  'git.remoteFailed',
])
const SHORT_CHARS = 48

/** A refusal of a clone's remote address, shown under that field rather than under the folder. */
export function isRemoteRefusal(refusal: Notice | null): refusal is Notice {
  return refusal !== null && REMOTE_CODES.has(refusal.code)
}

/** An address cut in the middle to a line's share: its host and its name stay. */
export function shortRemote(remote: string): string {
  if (remote.length <= SHORT_CHARS) return remote
  const head = Math.ceil((SHORT_CHARS - 1) / 2)
  return `${remote.slice(0, head)}…${remote.slice(remote.length - (SHORT_CHARS - 1 - head))}`
}

/**
 * A refusal as a line of the page says it (BTN-1087): one short line by the code with an address cut, and the tool's own
 * words apart, for a tip — the field is right above, a pasted paragraph is not echoed back. A command the line asks to
 * run (BTN-1091: `ssh -T` for an unknown host key) comes apart too, for a block with a copy button. The wizard's remote
 * field and the job window's failed step (BTN-1100) both say a refusal so.
 */
export function refusalParts(refusal: Notice): { shown: Notice; detail: string | null; command: string | null } {
  const params = refusal.params as { remote?: unknown; command?: unknown }
  const shown = {
    code: refusal.code,
    params: typeof params.remote === 'string' ? { ...params, remote: shortRemote(params.remote) } : refusal.params,
  } as Notice
  const detail = refusal.detail?.trim() ?? ''
  return { shown, detail: detail === '' ? null : detail, command: typeof params.command === 'string' ? params.command : null }
}
