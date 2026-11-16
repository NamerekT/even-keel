/** The port the hub listens on for machines when `EVEN_KEEL_MACHINES_PORT` names none. */
export const MACHINES_PORT = 4749

/** The port of the hub's listener for machines (`EVEN_KEEL_MACHINES_PORT`); a value that is no port is the default. */
export function machinesPortOf(env: NodeJS.ProcessEnv): number {
  const port = Number(env.EVEN_KEEL_MACHINES_PORT)
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : MACHINES_PORT
}

/**
 * The hub's address for machines as a person writes it — a host name or an IP, with a port when a proxy or a router
 * forwards another one — made the URL a connection string carries. `undefined` — not such an address.
 */
export function hubUrlOf(address: string, port: number): string | undefined {
  const text = address.trim().toLowerCase()
  if (text === '' || /[/\\@?#\s]/.test(text)) return undefined
  let url: URL
  try {
    url = new URL(`https://${text}`)
  } catch {
    return undefined
  }
  if (url.hostname === '') return undefined
  if (url.port === '') url.port = String(port)
  return url.origin
}
