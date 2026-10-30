import type { CheckResult } from '../state.js'
import type { TrackerProject } from '../tracker/source.js'
import type { ServerDeps } from '../server.js'
import { textOf } from '../server-request.js'
import type { ProfileRules } from './model.js'
import { profileDraftOf } from './request.js'
import type { ProfileDraft } from './service.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fail } from '../notice/notice.js'
import { callbackUrl } from './oauth-protocol.js'
import type { OAuthStatus } from './oauth.js'
import { oauthCallbackPage } from './oauth-response.js'

/** The trackers' profiles of the same tab; a project is named by its key. */
export interface ProfilesControl {
  check(draft: ProfileDraft): Promise<CheckResult>
  /** Returns the profile's id. */
  save(draft: ProfileDraft & { name: string }): Promise<string>
  remove(id: string): void
  setDefault(id: string): void
  /** The chain rules of the profile's projects; refused when one of them would clash. */
  setRules(id: string, rules: ProfileRules): void
  /** `null` — the project runs on its tracker's default profile. */
  link(project: string, profile: string | null): void
  projects(id: string, query: string): Promise<TrackerProject[]>
  oauth?: {
    start(draft: ProfileDraft, redirect: string): Promise<{ flow: string; url: string }>
    status(flow: string): OAuthStatus
    cancel(flow: string): void
    finish(params: URLSearchParams): Promise<void>
  }
}

export const PROFILE_QUERIES: Record<string, (deps: ServerDeps, body: Record<string, unknown>, request: IncomingMessage) => Promise<unknown>> = {
  'profiles/check': ({ profiles }, body) => profiles.check(profileDraftOf(body)),
  'profiles/save': async ({ profiles }, body) => ({ id: await profiles.save({ ...profileDraftOf(body), name: typeof body.name === 'string' ? body.name : '' }) }),
  'profiles/projects': ({ profiles }, body) => profiles.projects(textOf(body.id, 'id'), typeof body.query === 'string' ? body.query : ''),
  'profiles/oauth/start': async ({ profiles }, body, request) => {
    const origin = request.headers.origin
    if (!origin || new URL(origin).host !== request.headers.host) throw fail('profiles.oauthAddress', {})
    const redirect = callbackUrl(`${origin}/api/profiles/oauth/callback`)
    return oauthOf(profiles).start(profileDraftOf(body), redirect)
  },
  'profiles/oauth/status': async ({ profiles }, body) => oauthOf(profiles).status(textOf(body.flow, 'flow')),
  'profiles/oauth/cancel': async ({ profiles }, body) => { oauthOf(profiles).cancel(textOf(body.flow, 'flow')); return {} },
}

function oauthOf(profiles: ProfilesControl): NonNullable<ProfilesControl['oauth']> {
  if (!profiles.oauth) throw fail('profiles.oauthUnsupported', {})
  return profiles.oauth
}

export async function oauthCallback(profiles: ProfilesControl, params: URLSearchParams, response: ServerResponse): Promise<void> {
  // The original dialog polls the attempt; the final URL never carries codes or tokens.
  await oauthOf(profiles).finish(params).catch(() => {})
  oauthCallbackPage(response)
}
