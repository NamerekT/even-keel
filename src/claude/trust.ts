import { readFileSync } from 'node:fs'
import { isPlainObject } from '../settings/file.js'
import { samePath } from '../paths.js'
import { isTrusted } from '../projects/check.js'
import { writeAtomic } from '../storage/atomic.js'
import { NoticeError, fail } from '../notice/notice.js'

/** Add checkout trust without replacing any of the CLI's other settings. */
export function trustFolder(file: string, folder: string, platform: NodeJS.Platform = process.platform): void {
  try {
    let text: string | undefined
    try { text = readFileSync(file, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const config: unknown = text === undefined ? {} : JSON.parse(text.replace(/^\uFEFF/, ''))
    if (!isPlainObject(config) || (config.projects !== undefined && !isPlainObject(config.projects))) throw new Error('Invalid Claude configuration')
    if (isTrusted(config, folder, platform)) return
    const projects = config.projects === undefined ? {} : config.projects as Record<string, unknown>
    const key = Object.keys(projects).find((key) => samePath(key, folder, platform)) ?? folder
    const entry = projects[key]
    if (entry !== undefined && !isPlainObject(entry)) throw new Error('Invalid Claude project configuration')
    writeAtomic(file, `${JSON.stringify({ ...config, projects: { ...projects, [key]: { ...entry as object, hasTrustDialogAccepted: true } } }, null, 2)}\n`)
  } catch (error) {
    throw fail('claude.trustWriteFailed', { folder }, { detail: error instanceof Error ? error.message : String(error) }, { cause: error })
  }
}

/** What `claude --bg` prints when the folder's trust dialog was never accepted: it refuses to start, no session is made. */
const UNTRUSTED = /workspace not trusted/i

/**
 * The CLI's refusal of a folder Claude Code does not trust, as a notice that says what to do (BTN-429), or `null` for
 * any other failure. `folder` is the project's checkout: its trust covers the task worktrees inside it.
 */
export function untrustedStart(error: unknown, place: { task: string; folder: string; platform: string; user: string; service: boolean }): NoticeError | null {
  if (!(error instanceof NoticeError)) return null
  const { notice } = error
  if ((notice.code !== 'claude.startFailed' && notice.code !== 'claude.resumeFailed') || !UNTRUSTED.test(notice.detail ?? '')) return null
  return fail('claude.untrusted', { ...place, ...(notice.params.recovery === undefined ? {} : { recovery: notice.params.recovery }) }, {}, { cause: error })
}
