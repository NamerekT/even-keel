import type { CheckResult } from '../state.js'
import type { TrackerProject } from '../tracker/source.js'
import type { ServerDeps } from '../server.js'
import { textOf } from '../server-request.js'
import type { ProfileRules } from './model.js'
import { profileDraftOf } from './request.js'
import type { ProfileDraft } from './service.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fail } from '../notice/notice.js'
import { callbackUrl, type OAuthClient } from './oauth-protocol.js'
import type { OAuthStatus } from './oauth.js'

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
    start(draft: ProfileDraft, redirect: string, client?: OAuthClient): Promise<{ flow: string; url: string }>
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
    const client = body.client as Record<string, unknown> | undefined
    return oauthOf(profiles).start(profileDraftOf(body), redirect, client === undefined ? undefined : { id: textOf(client.id, 'client.id'), secret: textOf(client.secret, 'client.secret') })
  },
  'profiles/oauth/status': async ({ profiles }, body) => oauthOf(profiles).status(textOf(body.flow, 'flow')),
  'profiles/oauth/cancel': async ({ profiles }, body) => { oauthOf(profiles).cancel(textOf(body.flow, 'flow')); return {} },
}

function oauthOf(profiles: ProfilesControl): NonNullable<ProfilesControl['oauth']> {
  if (!profiles.oauth) throw fail('profiles.oauthUnsupported', {})
  return profiles.oauth
}

export async function oauthCallback(profiles: ProfilesControl, params: URLSearchParams, response: ServerResponse): Promise<void> {
  // The original dialog polls the attempt; the redirect URL never carries codes or tokens.
  await oauthOf(profiles).finish(params).catch(() => {})
  response.writeHead(303, { location: '/settings#trackers', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }).end()
}
