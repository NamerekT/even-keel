import type { CiKind } from '../../../src/ci/model.js'
import type { Notice } from '../../../src/notice/notice.js'

/** What gives PR mode a place to open pull requests (EKR-7): a profile for the remote's forge, or a remote. */
export type PullFix = { fix: 'profile'; kind: CiKind; web: string } | { fix: 'remote' }

/** By a readiness notice, or by a chain's pause whose cause is one (`review.notReady`, `review.notOpened`). */
export function pullFixOf(notice: Notice | null | undefined): PullFix | null {
  if (notice === null || notice === undefined) return null
  if (notice.code === 'review.notReady' || notice.code === 'review.notOpened') return pullFixOf(notice.cause)
  // A pause stored before the kind and the address were in the notice has nothing to open the dialog on.
  if (notice.code === 'review.noToken') return notice.params.kind === undefined ? null : { fix: 'profile', kind: notice.params.kind, web: notice.params.web }
  if (notice.code === 'review.noRemote') return { fix: 'remote' }
  return null
}

const PROFILE = 'profile'
const HOST = 'host'

/** /settings on the Access tab with the dialog of a new profile of the kind, its server's address filled in. */
export const profileAddPath = (kind: string, host: string): string => `/settings?${new URLSearchParams({ [PROFILE]: kind, [HOST]: host }).toString()}`

/** The profile `profileAddPath` asks to add; `null` — none. */
export function profileAddOf(params: URLSearchParams): { kind: string; host: string } | null {
  const kind = params.get(PROFILE)
  return kind === null || kind === '' ? null : { kind, host: params.get(HOST) ?? '' }
}

/** The search of a URL without the profile `profileAddPath` asked to add, once its dialog closes. */
export function withoutProfileAdd(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params)
  next.delete(PROFILE)
  next.delete(HOST)
  return next
}
