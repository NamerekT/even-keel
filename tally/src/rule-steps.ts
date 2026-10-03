import { lineDiff } from '../../src/stats/diff.js'
import type { KeyVersion, SnapshotFile, StoredChange, TallyDb } from './db.js'
import { loadRules, type Source } from './load.js'
import type { ParseContext } from './parse.js'
import { changesOf, pickPath, type Version } from './rule-changes.js'
import { addRuleText, emptyRuleRows } from './rule-parse.js'
import { infoOf, ruleText, type RuleSource } from './rule-scan.js'
import { hashOf } from './rules.js'

// Bump to re-read every transcript for rule rows after the rule parsing changes.
export const RULES_VERSION = '1'
const BACKFILL = 'rules_backfill'
const BOOTSTRAP = 'rules_bootstrap'

export async function snapshotRules(db: TallyDb, sources: RuleSource[], now: Date): Promise<number> {
  const stored = await db.snapshotFiles()
  const rows = emptyRuleRows()
  const files: SnapshotFile[] = []
  for (const source of sources) {
    const info = await infoOf(source.path)
    if (info === null) continue
    const known = stored.get(source.path)
    let hash = known !== undefined && known.size === info.size && known.mtime === info.mtime ? known.hash : undefined
    if (hash === undefined) {
      const text = await ruleText(source, info)
      hash = text === null ? null : addRuleText(rows, source.file, text)
    }
    if (!rows.ruleFiles.has(source.file.key)) rows.ruleFiles.set(source.file.key, source.file)
    files.push({ path: source.path, key: source.file.key, size: info.size, mtime: info.mtime, hash })
  }

  const byKey = new Map<string, SnapshotFile[]>()
  for (const file of files) if (file.hash !== null) byKey.set(file.key, [...(byKey.get(file.key) ?? []), file])
  const at = now.toISOString()
  const last = await db.lastSnapshots()
  const snapshots: { key: string; at: string; hash: string | null }[] = []
  for (const [key, list] of byKey) {
    const path = pickPath(list.map((file) => file.path))
    const hash = list.find((file) => file.path === path)!.hash
    if (last.get(key) !== hash) snapshots.push({ key, at, hash })
  }
  for (const [key, hash] of last) if (hash !== null && !byKey.has(key)) snapshots.push({ key, at, hash: null })

  if ((await db.meta(BOOTSTRAP)) === null) await db.setMeta(BOOTSTRAP, at)
  await db.writeSnapshots(rows, files, snapshots)
  return snapshots.length
}

export async function backfillRules(db: TallyDb, sources: Source[], context: (source: Source) => ParseContext, chunkBytes: number, log: (message: string) => void): Promise<boolean> {
  if ((await db.meta(BACKFILL)) === RULES_VERSION) return false
  const started = Date.now()
  await db.forgetTranscriptRules()
  let lines = 0
  for (const source of sources) {
    try {
      lines += await loadRules(source.path, (batch) => db.writeRules(batch), context(source), chunkBytes)
    } catch (error) {
      log(`tally: rules backfill ${source.path}: ${(error as Error).message}`)
    }
  }
  await db.setMeta(BACKFILL, RULES_VERSION)
  log(`tally: rules backfill read ${sources.length} files, ${lines} lines, ${((Date.now() - started) / 1000).toFixed(1)} s`)
  return true
}

export async function refreshRuleChanges(db: TallyDb): Promise<number> {
  const { seen, snapshots } = await db.ruleVersions()
  const bootstrap = await db.meta(BOOTSTRAP)
  const grouped = (versions: KeyVersion[]) => {
    const map = new Map<string, Version[]>()
    for (const { key, hash, at } of versions) map.set(key, [...(map.get(key) ?? []), { hash, at }])
    return map
  }
  const seenByKey = grouped(seen)
  const snapshotsByKey = grouped(snapshots)
  const keys = new Set([...seenByKey.keys(), ...snapshotsByKey.keys()])
  const derived = new Map<string, ReturnType<typeof changesOf>[number]>()
  for (const key of keys) {
    for (const change of changesOf(key, seenByKey.get(key) ?? [], snapshotsByKey.get(key) ?? [], bootstrap)) {
      derived.set(changeId(change.key, change.at, change.newHash), change)
    }
  }

  const existing = await db.ruleChangeIds()
  const fresh = [...derived].filter(([id]) => !existing.has(id))
  const removed = [...existing].filter((id) => !derived.has(id))
  if (fresh.length === 0 && removed.length === 0) return 0
  const hashes = [...new Set(fresh.flatMap(([, change]) => [change.oldHash, change.newHash]).filter((hash): hash is string => hash !== null))]
  const texts = await db.ruleTextsOf(hashes)
  const added: StoredChange[] = fresh.map(([id, change]) => {
    const diff = lineDiff(change.oldHash === null ? null : (texts.get(change.oldHash) ?? ''), change.newHash === null ? null : (texts.get(change.newHash) ?? ''))
    return { id, ...change, added: diff.added, removed: diff.removed }
  })
  await db.writeRuleChanges(added, removed)
  return added.length
}

function changeId(key: string, at: string, hash: string | null): string {
  return hashOf(`${key}|${at}|${hash ?? ''}`)
}
