export type VersionSource = 'file-history' | 'backup' | 'git'

export interface Version {
  at: string
  hash: string | null
  source?: VersionSource
}

export type ChangeSource = 'snapshot' | 'transcript' | VersionSource

export interface RuleChange {
  key: string
  at: string
  oldHash: string | null
  newHash: string | null
  source: ChangeSource
}

// A key's timeline: what sessions saw and older versions found in file-history, backups and git (each version from
// its first sighting) until the first snapshot, then the snapshots. The first transcript version and the bootstrap snapshot are initial states, not changes: a session in
// a worktree sees its branch's text, and a skill body in a transcript has no frontmatter, so their texts are never
// compared with the files on disk across that boundary except for a snapshot taken after the bootstrap.
export function changesOf(key: string, seen: Version[], snapshots: Version[], bootstrapAt: string | null): RuleChange[] {
  const byTime = (a: Version, b: Version) => a.at.localeCompare(b.at)
  const sorted = [...snapshots].sort(byTime)
  const firstSnapshot = sorted[0]?.at
  const timeline = [
    ...[...seen].sort(byTime).filter((version) => firstSnapshot === undefined || version.at < firstSnapshot).map((version) => ({ ...version, source: version.source ?? ('transcript' as ChangeSource) })),
    ...sorted.map((version) => ({ ...version, source: 'snapshot' as ChangeSource })),
  ]
  const changes: RuleChange[] = []
  let known = false
  let previous: string | null = null
  for (const version of timeline) {
    const initial = version.source === 'snapshot' ? bootstrapAt !== null && version.at <= bootstrapAt : !known
    if (!initial && (!known || version.hash !== previous)) {
      changes.push({ key, at: version.at, oldHash: previous, newHash: version.hash, source: version.source })
    }
    known = true
    previous = version.hash
  }
  return changes
}

// A file the scanner sees for the first time but older than the previous scan was there all along (the scanned set
// grew): dated to the bootstrap it is an initial state, not a new file.
export function firstSnapshotAt(mtime: string, previousScan: string | null, bootstrapAt: string | null, now: string): string {
  return bootstrapAt !== null && previousScan !== null && mtime < previousScan ? bootstrapAt : now
}

// A file is gone only where this run looked: global files always, a project's only when its repository was listed.
// A project that dropped out of the snapshot (config unread, empty, of an unknown form; git failed) is left as it was.
export function goneKeys(last: Map<string, string | null>, present: Set<string>, listed: string[]): string[] {
  const looked = (key: string) => key.startsWith('~/') || listed.some((root) => key.startsWith(`${root}/`))
  return [...last].filter(([key, hash]) => hash !== null && !present.has(key) && looked(key)).map(([key]) => key)
}

const isGlobal =(path: string) => /[\\/]\.claude[\\/]/i.test(path) && !/[\\/]\.claude-accounts[\\/]/i.test(path)

export function pickPath(paths: string[]): string {
  return [...paths].sort((a, b) => Number(isGlobal(b)) - Number(isGlobal(a)) || a.localeCompare(b))[0]!
}
