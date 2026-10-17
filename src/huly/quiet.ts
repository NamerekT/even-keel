// The Huly client warns this through console.warn for every stale model transaction on each
// connect and reconnect — thousands of harmless lines in the service log — and takes no logger.
const MODEL_NOISE = 'no document found, failed to apply model transaction'

type Warn = (...args: unknown[]) => void

export function withoutModelNoise(warn: Warn): Warn {
  return (...args) => {
    if (typeof args[0] === 'string' && args[0].startsWith(MODEL_NOISE)) return
    warn(...args)
  }
}

let quieted = false

export function quietModelNoise(): void {
  if (quieted) return
  quieted = true
  console.warn = withoutModelNoise(console.warn.bind(console))
}
