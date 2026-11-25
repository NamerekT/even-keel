import { MEMORY_INDEX } from '../record.js'

/** What a `MemorySync` keeps: a project's memory folder, or the user's global configuration `~/.claude-config` (BTN-1690). */
export type SyncKind = 'memory' | 'config'

export interface SyncFlavor {
  kind: SyncKind
  /** The repository's `.gitattributes`, also laid into `.git/info/attributes` for the first rebase of a copy. */
  attributes: string
  /** The commit trailer of a conflict kept for later (`conflictTrailer`). */
  trailer: string
  /** `MEMORY.md` is tidied by `reindex` after every fetch. */
  index: boolean
  /** The folder has subfolders: its watcher goes into them. */
  nested: boolean
  /**
   * A file a person settles: never merged, three-way or by a session. A change of it on both sides keeps the newer
   * version and leaves a conflict for the page (BTN-1690: hooks and `settings.json`).
   */
  human(path: string): boolean
  /** Two versions with no common one are a conflict, not just the newer kept. */
  firstMeetingConflicts: boolean
}

export const MEMORY_FLAVOR: SyncFlavor = {
  kind: 'memory',
  attributes: `${MEMORY_INDEX} merge=union\n`,
  trailer: 'Memory-Conflict',
  index: true,
  nested: false,
  human: () => false,
  firstMeetingConflicts: false,
}

/** The global configuration's files a person settles: their paths in the repository. */
const HUMAN = /^(?:hooks\/|settings\.json$)/

export const CONFIG_FLAVOR: SyncFlavor = {
  kind: 'config',
  // `-merge`: a rebase stops at any change of both sides instead of merging the lines, so `settleMet` sees every one.
  attributes: 'hooks/** -merge\nsettings.json -merge\n',
  trailer: 'Config-Conflict',
  index: false,
  nested: true,
  human: (path) => HUMAN.test(path.replace(/\\/g, '/')),
  // A machine joining with its own `CLAUDE.md` or a skill of the same name must not replace the network's silently.
  firstMeetingConflicts: true,
}

export function flavorOf(kind: SyncKind): SyncFlavor {
  return kind === 'config' ? CONFIG_FLAVOR : MEMORY_FLAVOR
}
