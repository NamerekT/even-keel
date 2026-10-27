import { createHash, randomBytes } from 'node:crypto'
import { fail, noticeOf, type Notice } from '../notice/notice.js'
import { callbackUrl, exchange, OAuthRefused, register, type OAuthClient, type OAuthRecord, type Registration } from './oauth-protocol.js'
export { MCP_OAUTH, type OAuthRecord } from './oauth-protocol.js'

export interface OAuthDraft { id?: string; kind: string; values: Record<string, string | null> }
export interface OAuthStatus { state: 'waiting' | 'ready' | 'failed'; error: Notice | null }
interface Flow extends OAuthStatus {
  expires: number
  binding: string
  values: Record<string, string | null>
  kind: string
  oauthState: string
  verifier: string
  registration: Registration
  used: boolean
  record?: OAuthRecord
}
interface Deps {
  get: (id: string) => OAuthRecord | undefined
  /** Compare-and-swap: a late refresh must not restore an edited or removed profile's credentials. */
  put: (id: string, expected: OAuthRecord, next: OAuthRecord) => Promise<boolean>
  verify: (kind: string, values: Record<string, string | null>, token: string) => Promise<void>
  fetch?: typeof fetch
  now?: () => number
}
const binding = (draft: OAuthDraft) => createHash('sha256').update(JSON.stringify([draft.id ?? null, draft.kind, Object.entries(draft.values).sort(([a], [b]) => a.localeCompare(b))])).digest('hex')
const random = () => randomBytes(32).toString('base64url')

/** Browser grants for unsaved drafts and single-flight refreshes of stored profiles. */
export class McpOAuth {
  private readonly flows = new Map<string, Flow>()
  private readonly refreshing = new Map<string, Promise<string>>()
  private readonly request: typeof fetch
  private readonly now: () => number

  constructor(private readonly deps: Deps) {
    this.request = deps.fetch ?? fetch
    this.now = deps.now ?? Date.now
  }

  async start(draft: OAuthDraft, redirect: string, client?: OAuthClient): Promise<{ flow: string; url: string }> {
    this.prune()
    if (this.flows.size >= 32) throw fail('profiles.oauthFailed', {})
    const registration = await register(draft.kind, callbackUrl(redirect), this.request, client)
    const id = random()
    const verifier = random()
    const state = random()
    const url = new URL(registration.authorizationEndpoint)
    url.search = new URLSearchParams({ response_type: 'code', client_id: registration.clientId, redirect_uri: registration.redirect, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString()
    if (registration.resource) url.searchParams.set('resource', registration.resource)
    const scope = registration.scope
    if (scope) url.searchParams.set('scope', scope)
    this.flows.set(id, { expires: this.now() + 10 * 60_000, binding: binding(draft), values: draft.values, kind: draft.kind, oauthState: state, verifier, registration, used: false, state: 'waiting', error: null })
    return { flow: id, url: url.href }
  }

  async finish(params: URLSearchParams): Promise<void> {
    this.prune()
    const state = params.get('state')
    const flow = [...this.flows.values()].find((each) => each.oauthState === state)
    if (!flow || flow.used) throw fail('profiles.oauthExpired', {})
    flow.used = true
    try {
      if (params.has('error') || !params.get('code')) throw fail('profiles.oauthDenied', {})
      const { authorizationEndpoint: _, issuer, requireIssuer, scope: _scope, ...registration } = flow.registration
      if ((requireIssuer || params.has('iss')) && params.get('iss') !== issuer) throw fail('profiles.oauthFailed', {})
      const record = await exchange(registration, { grant_type: 'authorization_code', code: params.get('code')!, code_verifier: flow.verifier, redirect_uri: registration.redirect }, this.request, this.now())
      await this.deps.verify(flow.kind, flow.values, record.accessToken)
      flow.record = record
      flow.state = 'ready'
    } catch (error) {
      flow.state = 'failed'
      flow.error = error instanceof OAuthRefused ? noticeOf(fail('profiles.oauthDenied', {})) : noticeOf(fail('profiles.oauthFailed', {}))
      throw fail('profiles.oauthFailed', {})
    }
  }

  status(id: string): OAuthStatus {
    const flow = this.flow(id)
    return { state: flow.state, error: flow.error }
  }

  completed(id: string, draft: OAuthDraft): OAuthRecord {
    const flow = this.flow(id)
    if (flow.binding !== binding(draft) || flow.state !== 'ready' || !flow.record) throw fail('profiles.oauthExpired', {})
    return flow.record
  }

  forget(id: string): void { this.flows.delete(id) }

  /** Checks the selected grant, refreshing it on expiry or one upstream rejection. */
  async check(id: string, kind: string, values: Record<string, string>, draft?: OAuthDraft): Promise<OAuthRecord> {
    const flow = draft === undefined ? undefined : this.flow(id)
    const initial = draft === undefined ? this.deps.get(id) : this.completed(id, draft)
    if (!initial || initial.reconnect) throw fail('profiles.oauthReconnect', {})
    let record = initial
    const renew = async (rejected?: string) => {
      if (!flow) return this.token(id, rejected)
      if (record.accessToken !== rejected && (record.expiresAt === null || record.expiresAt > this.now() + 30_000)) return record.accessToken
      if (!record.refreshToken) throw new OAuthRefused()
      record = await exchange(record, { grant_type: 'refresh_token', refresh_token: record.refreshToken }, this.request, this.now())
      flow.record = record
      return record.accessToken
    }
    let token: string | undefined
    try {
      token = await renew()
      try { await this.deps.verify(kind, values, token) }
      catch (error) {
        if (!(error instanceof OAuthRefused)) throw error
        token = await renew(token)
        await this.deps.verify(kind, values, token)
      }
    } catch (error) {
      if (error instanceof OAuthRefused) {
        if (flow) flow.record = { ...record, reconnect: true }
        else if (token) await this.refused(id, token)
        throw fail('profiles.oauthReconnect', {})
      }
      throw error
    }
    return flow?.record ?? this.deps.get(id)!
  }

  async token(id: string, rejected?: string): Promise<string> {
    const record = this.deps.get(id)
    if (!record || record.reconnect) throw fail('profiles.oauthReconnect', {})
    if (record.accessToken !== rejected && (record.expiresAt === null || record.expiresAt > this.now() + 30_000)) return record.accessToken
    const pending = this.refreshing.get(id)
    if (pending) return pending
    const refresh = this.refresh(id, record)
    this.refreshing.set(id, refresh)
    try { return await refresh } finally { if (this.refreshing.get(id) === refresh) this.refreshing.delete(id) }
  }

  async refused(id: string, token: string): Promise<void> {
    const record = this.deps.get(id)
    if (record?.accessToken === token) await this.deps.put(id, record, { ...record, reconnect: true })
  }

  private async refresh(id: string, record: OAuthRecord): Promise<string> {
    try {
      if (!record.refreshToken) throw new OAuthRefused()
      const next = await exchange(record, { grant_type: 'refresh_token', refresh_token: record.refreshToken }, this.request, this.now())
      if (!await this.deps.put(id, record, next)) throw fail('profiles.oauthExpired', {})
      return next.accessToken
    } catch (error) {
      if (error instanceof OAuthRefused) {
        await this.deps.put(id, record, { ...record, reconnect: true })
        throw fail('profiles.oauthReconnect', {})
      }
      throw fail('profiles.oauthFailed', {})
    }
  }

  private flow(id: string): Flow {
    this.prune()
    const flow = this.flows.get(id)
    if (!flow) throw fail('profiles.oauthExpired', {})
    return flow
  }

  private prune(): void {
    for (const [id, flow] of this.flows) if (flow.expires <= this.now()) this.flows.delete(id)
  }
}
