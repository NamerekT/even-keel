import { errorReason } from '../error-reason.js'
import { hookRouteOf } from '../link/hooks.js'
import { HOOK_TIMEOUT_MS } from '../link/machine-transport.js'
import type { HookAnswer, HookRequest } from '../link/protocol.js'

export interface HubHooksDeps {
  /** The hub's page; `undefined` — it does not listen. */
  origin(): string | undefined
  /** The machine the hub knows to hold the session, its own one too; `undefined` — none yet. */
  holder(session: string): string | undefined
  log(line: string): void
}

const answerOf = (status: number): HookAnswer => ({ status, body: '' })

/**
 * The hub's side of the hooks of a machine's sessions (BTN-1260, `docs/machines/link.md`, "Hooks through the hub"): a route
 * of the hooks is asked of the hub's own page, as a session of the hub's machine asks it; a session another machine
 * holds is not the machine's to ask about.
 */
export class HubHooks {
  constructor(private readonly deps: HubHooksDeps) {}

  async relay(machine: string, request: HookRequest): Promise<HookAnswer> {
    const route = hookRouteOf(request.method, request.path)
    const shown = request.path.split('?')[0]
    if (route === undefined) {
      this.deps.log(`link: machine ${machine} asked ${request.method} ${shown}, no route of the hooks: refused`)
      return answerOf(404)
    }
    const holder = route.session === undefined ? undefined : this.deps.holder(route.session)
    if (holder !== undefined && holder !== machine) {
      this.deps.log(`link: machine ${machine} asked ${request.method} ${shown} about a session of machine ${holder}: refused`)
      return answerOf(403)
    }
    const origin = this.deps.origin()
    if (origin === undefined) return answerOf(503)
    try {
      const response = await fetch(`${origin}${route.path}`, {
        method: request.method,
        ...(request.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: request.body }),
        redirect: 'error',
        signal: AbortSignal.timeout(HOOK_TIMEOUT_MS),
      })
      return { status: response.status, body: await response.text() }
    } catch (error) {
      this.deps.log(`link: the hub's page did not answer ${request.method} ${shown} of machine ${machine}: ${errorReason(error)}`)
      return answerOf(502)
    }
  }
}
