import { AsyncLocalStorage } from 'node:async_hooks'

export interface CallDiagnostics {
  operation: string
  requests: number
  measured: boolean
  longest?: { path: string; ms: number }
  active: Map<symbol, { path: string; started: number }>
  signal?: AbortSignal
}

export const callDiagnostics = new AsyncLocalStorage<CallDiagnostics>()

export async function trackedFetch(fetchImpl: typeof fetch, input: string, init: RequestInit, path: string): Promise<Response> {
  const finish = trackRequest(path)
  try {
    const signal = callDiagnostics.getStore()?.signal
    return await fetchImpl(input, signal === undefined ? init : { ...init, signal: init.signal ? AbortSignal.any([init.signal, signal]) : signal })
  } finally {
    finish()
  }
}

export function trackRequest(path: string): () => void {
  const call = callDiagnostics.getStore()
  if (!call) return () => {}
  call.measured = true
  call.requests++
  const started = Date.now()
  const safePath = path.split('?')[0]!.replace(/\/uploads\/.*$/, '/uploads/[redacted]')
  const id = Symbol()
  call.active.set(id, { path: safePath, started })
  return () => {
    const ms = Date.now() - started
    call.active.delete(id)
    if (!call.longest || ms > call.longest.ms) call.longest = { path: safePath, ms }
  }
}

export function longestRequest(call: CallDiagnostics): { path: string; ms: number } | undefined {
  let longest = call.longest
  for (const request of call.active.values()) {
    const ms = Date.now() - request.started
    if (!longest || ms > longest.ms) longest = { path: request.path, ms }
  }
  return longest
}
