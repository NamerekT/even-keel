/**
 * The page's routes a session's hooks ask (`plugins/agent-bridge/hooks/evenkeel.mjs`, the trackers' calibration
 * hooks): the only ones a machine elsewhere carries to its hub (BTN-1260, `docs/machines.md`, "Hooks through the
 * hub"). `path` — the path with its query, as the hub's page is asked it; `session` — the session a route is about.
 */
export interface HookRoute {
  path: string
  session?: string
}

const SESSION_ROUTES = new Map<string, readonly string[]>([
  ['checkpoint', ['GET']],
  ['note', ['GET']],
  ['check', ['GET', 'POST']],
  ['standards', ['GET']],
  ['outsider', ['POST']],
  ['mail', ['POST']],
  ['permission', ['POST']],
])

/** `undefined` — no route of the hooks. */
export function hookRouteOf(method: string, path: string): HookRoute | undefined {
  if (!path.startsWith('/') || path.startsWith('//')) return undefined
  const url = new URL(path, 'http://hook')
  const target = `${url.pathname}${url.search}`
  const session = /^\/api\/sessions\/([^/]+)\/([a-z]+)$/.exec(url.pathname)
  if (session !== null) {
    if (SESSION_ROUTES.get(session[2]!)?.includes(method) !== true) return undefined
    try {
      return { path: target, session: decodeURIComponent(session[1]!) }
    } catch {
      return undefined
    }
  }
  if (method === 'GET' && /^\/api\/projects\/[A-Z][A-Z0-9]*\/calibration$/.test(url.pathname)) return { path: target }
  return undefined
}
