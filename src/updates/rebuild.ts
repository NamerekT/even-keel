import type { UpdateRecord } from './model.js'

interface HubState {
  hubCommit?: unknown
  startedAt?: unknown
  updates?: { current?: unknown; source?: unknown }
}

/** Only a run that started this process identifies a hub predating hubCommit. */
function legacyCommit(previous: UpdateRecord | null, version: string, startedAt: string): string | undefined {
  if (previous?.mode !== 'rebuild' || previous.from.version !== version) return undefined
  const start = Date.parse(startedAt)
  if (!(Date.parse(previous.startedAt) <= start && start <= Date.parse(previous.finishedAt))) return undefined
  // Older runners stored the built HEAD in "from". New ones can also have restored an older hub.
  if (previous.to === null && previous.failed === null) return previous.from.commit
  if (previous.to !== null && (previous.failed?.step === 'start' || previous.failed?.step === 'answer') && previous.rollback?.failed === null) return previous.from.commit
  return undefined
}

export function runningBeforeRebuild(state: HubState, previous: UpdateRecord | null) {
  const { hubCommit, startedAt, updates } = state
  const version = updates?.current
  if (updates?.source !== 'git' || typeof version !== 'string' || !version || typeof startedAt !== 'string' || !Number.isFinite(Date.parse(startedAt))) {
    throw new Error('Expected the state of a running hub installed from a checkout')
  }
  const legacy = hubCommit === undefined
  const commit = legacy ? legacyCommit(previous, version, startedAt) : hubCommit
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error('Cannot identify the running commit. For an older hub, build and restart the intended checkout once before using automatic rebuilds.')
  }
  return { version, commit, startedAt, legacy }
}
