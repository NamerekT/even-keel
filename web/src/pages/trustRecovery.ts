import type { Notice } from '../../../src/notice/notice.js'

type Untrusted = Extract<Notice, { code: 'claude.untrusted' }>['params']

/** A CLI trust refusal, including one wrapped in a chain error. */
export function untrustedOf(notice: Notice | null | undefined): Untrusted | null {
  if (notice == null) return null
  if (notice.code === 'claude.untrusted') return notice.params
  for (const item of notice.items ?? []) {
    const found = untrustedOf(item)
    if (found !== null) return found
  }
  return untrustedOf(notice.cause)
}

const quoted = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`

/** Preserve the terminal and service-user commands offered before automatic trust. */
export function trustCommandsOf(place: Untrusted): { own: string; as: string | null } {
  const { folder, platform, user } = place
  const own = platform === 'win32' ? `pushd "${folder}" && claude` : `cd ${quoted(folder)} && claude`
  const service = place.service ?? true
  const as = !service ? null : platform === 'win32'
    ? `runas /user:${user} "cmd /k cd /d ${folder} && claude"`
    : `cd ${quoted(folder)} && sudo -u ${quoted(user)} -H claude`
  return { own, as }
}
