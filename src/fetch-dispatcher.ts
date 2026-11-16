import { Agent, setGlobalDispatcher } from 'undici'

/**
 * Sends every `fetch` and `WebSocket` of the process over HTTP/1.1. Node 26's own fetch negotiates HTTP/2 wherever the
 * server offers it, and its undici 8.12.2 can emit `error` on an HTTP/2 stream it no longer listens to when an idle
 * session is torn down (`InformationalError: socket idle timeout`, nodejs/undici#5936): an uncaught exception that
 * stops the service. The service gains nothing from HTTP/2, so it is off; the dispatcher comes from the `undici`
 * package, where the fix of that bug already is.
 */
export function fetchOverHttp1(): void {
  setGlobalDispatcher(new Agent({ allowH2: false }))
}
