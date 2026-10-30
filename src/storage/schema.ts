import { fail } from '../notice/notice.js'

/**
 * The version of the format of everything Even Keel keeps: the config and the files of `state/`. A change of any
 * file's format is a new version, a step in `migrations.ts` and a new frozen sample in `test/fixtures/schema-v<N>/`.
 * A future import into a database reads it to know what it imports.
 */
export const SCHEMA_VERSION = 21

/** A file without a version is from before versions: 1. */
export function versionOf(raw: unknown): number {
  const version = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as { version?: unknown }).version : undefined
  return typeof version === 'number' && Number.isInteger(version) && version > 0 ? version : 1
}

/** The first line of a v2+ `.jsonl` log: `{"version":2}` and nothing else. */
export function isVersionLine(line: unknown): boolean {
  return typeof line === 'object' && line !== null && !Array.isArray(line) && Object.keys(line).length === 1 && 'version' in line
}

/** Throws for a file a newer Even Keel wrote: this code must not write over it. */
export function refuseNewer(file: string, version: number): void {
  if (version > SCHEMA_VERSION) throw fail('storage.newer', { file, version, known: SCHEMA_VERSION })
}
