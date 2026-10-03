import { readFile } from 'node:fs/promises'
import type { AccountHome } from '../../src/account/homes.js'
import { lineDiff } from '../../src/stats/diff.js'
import type { KeyVersion, SnapshotFile, StoredChange, TallyDb } from './db.js'
import { loadRules, type Source } from './load.js'
import type { ParseContext } from './parse.js'
import { changesOf, firstSnapshotAt, pickPath, type Version } from './rule-changes.js'
import { backupVersions, gitVersions } from './rule-history.js'
import { parseImports } from './rule-imports.js'
import { addRuleText, emptyRuleRows } from './rule-parse.js'
import { infoOf, ruleText, type RuleSource } from './rule-scan.js'
import { hashOf } from './rules.js'

// Bump to re-read every transcript for rule rows after the rule parsing changes.
export const RULES_VERSION = '2'
const BACKFILL = 'rules_backfill'
const BOOTSTRAP = 'rules_bootstrap'
const SCANNED = 'rules_scanned'

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
  const bootstrap = await db.meta(BOOTSTRAP)
  const previousScan = (await db.meta(SCANNED)) ?? bootstrap
  const snapshots: { key: string; at: string; hash: string | null }[] = []
  for (const [key, list] of byKey) {
    const path = pickPath(list.map((file) => file.path))
    const chosen = list.find((file) => file.path === path)!
    if (last.get(key) === chosen.hash) continue
    snapshots.push({ key, at: last.has(key) ? at : firstSnapshotAt(chosen.mtime, previousScan, bootstrap, at), hash: chosen.hash })
  }
  for (const [key, hash] of last) if (hash !== null && !byKey.has(key)) snapshots.push({ key, at, hash: null })

  if (bootstrap === null) await db.setMeta(BOOTSTRAP, at)
  await db.writeSnapshots(rows, files, snapshots)
  await db.setMeta(SCANNED, at)
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

// Backups are few and re-read each run; git is read from the last head of each project's main.
export async function collectRuleHistory(db: TallyDb, homes: AccountHome[], projects: string[], home: string, log: (message: string) => void): Promise<number> {
  const backups = await backupVersions(homes, home)
  await db.writeRules(backups)
  let versions = 0
  for (const repo of projects) {
    const name = `rules_git:${repo.replaceAll('\\', '/').toLowerCase()}`
    try {
      const { head, rows } = await gitVersions(repo, home, await db.meta(name))
      await db.writeRules(rows)
      await db.setMeta(name, head)
      versions += rows.ruleVersions.size
    } catch (error) {
      log(`tally: git history of rule files in ${repo}: ${(error as Error).message.split('\n')[0]}`)
    }
  }
  return versions
}

export async function refreshRuleChanges(db: TallyDb): Promise<number> {
  const { seen, snapshots } = await db.ruleVersions()
  const bootstrap = await db.meta(BOOTSTRAP)
  const grouped = (versions: KeyVersion[]) => {
    const map = new Map<string, Version[]>()
    for (const { key, ...version } of versions) map.set(key, [...(map.get(key) ?? []), version])
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

// A missing file leaves the stored imports as they are: it may be on its way back.
export async function importRuleHistory(db: TallyDb, path: string, log: (message: string) => void): Promise<number> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
  const { rows, errors } = parseImports(text)
  for (const error of errors) log(`tally: ${path}:${error.line}: ${error.message}`)
  return (await db.syncImports(rows)).added
}

function changeId(key: string, at: string, hash: string | null): string {
  return hashOf(`${key}|${at}|${hash ?? ''}`)
}
