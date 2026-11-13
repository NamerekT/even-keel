import { notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'
import type { BackupView } from '../../../src/storage/backup-model.js'
import { ago } from './fakeSessions.js'

const DIR = 'D:\\even-keel\\state\\backups'

/** `?backup=failed|checkFailed|none|running` (BTN-1083); without it the last copy was checked 5 h ago. */
export function fakeBackup(mode: string | null): BackupView {
  const view: BackupView = { dir: DIR, at: ago(5 * 60), running: false, failure: null }
  if (mode === 'failed') return { ...view, at: ago(26 * 60), failure: notice('storage.backupFailed', {}) }
  if (mode === 'checkFailed') return { ...view, at: ago(26 * 60), failure: notice('storage.backupCheckFailed', {}) }
  if (mode === 'none') return { ...view, at: null }
  if (mode === 'running') return { ...view, running: true }
  return view
}

/** "Make a copy now": the fake copy is checked at once. */
export function fakeBackupCommand(state: EvenKeelState, name: string): EvenKeelState | null {
  if (name !== 'storage/backup' || state.backup === undefined) return null
  return { ...state, backup: { ...state.backup, at: ago(0), running: false, failure: null } }
}
