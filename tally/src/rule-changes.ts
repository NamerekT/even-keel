export interface Version {
  at: string
  hash: string | null
}

export type ChangeSource = 'snapshot' | 'transcript'

export interface RuleChange {
  key: string
  at: string
  oldHash: string | null
  newHash: string | null
  source: ChangeSource
}

// A key's timeline: what sessions saw (each version from its first sighting) until the first snapshot, then the
// snapshots. The first transcript version and the bootstrap snapshot are initial states, not changes: a session in
// a worktree sees its branch's text, and a skill body in a transcript has no frontmatter, so their texts are never
// compared with the files on disk across that boundary except for a snapshot taken after the bootstrap.
export function changesOf(key: string, seen: Version[], snapshots: Version[], bootstrapAt: string | null): RuleChange[] {
  const byTime = (a: Version, b: Version) => a.at.localeCompare(b.at)
  const sorted = [...snapshots].sort(byTime)
  const firstSnapshot = sorted[0]?.at
  const timeline = [
    ...[...seen].sort(byTime).filter((version) => firstSnapshot === undefined || version.at < firstSnapshot).map((version) => ({ ...version, source: 'transcript' as const })),
    ...sorted.map((version) => ({ ...version, source: 'snapshot' as const })),
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

const isGlobal = (path: string) => /[\\/]\.claude[\\/]/i.test(path) && !/[\\/]\.claude-accounts[\\/]/i.test(path)

export function pickPath(paths: string[]): string {
  return [...paths].sort((a, b) => Number(isGlobal(b)) - Number(isGlobal(a)) || a.localeCompare(b))[0]!
}
