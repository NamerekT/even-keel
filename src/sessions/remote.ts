export type RemoteOff = 'starting' | 'disabled' | 'no-bridge'

export interface RemoteLink {
  url: string | null
  off: RemoteOff | null
}

export interface RemoteFacts {
  bridge: string | null
  transcriptUrl: string | null
  enabled: boolean
  startedAt: number
  now: number
}

const REMOTE_BASE = 'https://claude.ai/code/'
const STARTUP_GRACE_MS = 30_000

export function remoteUrlOf(bridgeSessionId: string): string {
  return REMOTE_BASE + bridgeSessionId.replace(/^cse_/, 'session_')
}

export function bridgeOfRecord(raw: string | undefined, sessionId: string): string | null {
  const record = parseObject(raw)
  if (record?.sessionId !== sessionId) return null
  return typeof record.bridgeSessionId === 'string' && record.bridgeSessionId !== '' ? record.bridgeSessionId : null
}

export function remoteAtStartup(rawSettings: string | undefined): boolean {
  return parseObject(rawSettings)?.remoteControlAtStartup === true
}

export function remoteLink(facts: RemoteFacts): RemoteLink {
  const url = facts.bridge !== null ? remoteUrlOf(facts.bridge) : facts.transcriptUrl
  if (url !== null) return { url, off: null }
  if (!facts.enabled) return { url: null, off: 'disabled' }
  if (facts.now - facts.startedAt < STARTUP_GRACE_MS) return { url: null, off: 'starting' }
  return { url: null, off: 'no-bridge' }
}

function parseObject(raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}
