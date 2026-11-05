import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
    // A file system error has a code; a parse error or a wrong shape has none.
    const reason = typeof (error as NodeJS.ErrnoException).code === 'string' ? 'access' : 'invalid'
    throw fail('claude.trustWriteFailed', { folder, file, reason }, { detail: error instanceof Error ? error.message : String(error) }, { cause: error })
  }
}

const psQuoted = (text: string) => `'${text.replace(/'/g, "''")}'`

/**
 * The refused invocation as a `.ps1` the service user runs through `runas` (EKR-87): a short command naming a file the
 * user can open and read, instead of a PowerShell line quoted twice over. UTF-8 with a BOM, so Windows PowerShell 5
 * reads non-ASCII paths right. Returns the path, or `undefined` when the file cannot be written.
 */
function writeTrustScript(dir: string, task: string, folder: string, recovery: { binary: string; configDir: string | null }): string | undefined {
  const file = join(dir, 'trust', `${task.replace(/[^\w.-]/g, '_')}.ps1`)
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    `Set-Location -LiteralPath ${psQuoted(folder)}`,
    recovery.configDir === null ? 'Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue' : `$env:CLAUDE_CONFIG_DIR = ${psQuoted(recovery.configDir)}`,
    `& ${psQuoted(recovery.binary)}`,
  ]
  try {
    writeAtomic(file, `﻿${lines.join('\r\n')}\r\n`)
    return file
  } catch (error) {
    console.warn(`trust: could not write ${file}: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

/** What `claude --bg` prints when the folder's trust dialog was never accepted: it refuses to start, no session is made. */
const UNTRUSTED = /workspace not trusted/i

/**
 * The CLI's refusal of a folder Claude Code does not trust, as a notice that says what to do (BTN-429), or `null` for
 * any other failure. `folder` is the project's checkout: its trust covers the task worktrees inside it. With
 * `scriptDir` (the state folder), a Windows service's refusal also gets the script its `runas` command opens.
 */
export function untrustedStart(error: unknown, place: { task: string; folder: string; platform: string; user: string; service: boolean }, scriptDir?: string): NoticeError | null {
  if (!(error instanceof NoticeError)) return null
  const { notice } = error
  if ((notice.code !== 'claude.startFailed' && notice.code !== 'claude.resumeFailed') || !UNTRUSTED.test(notice.detail ?? '')) return null
  const { recovery } = notice.params
  const script = recovery !== undefined && scriptDir !== undefined && place.platform === 'win32' && place.service
    ? writeTrustScript(scriptDir, place.task, place.folder, recovery)
    : undefined
  return fail('claude.untrusted', { ...place, ...(recovery === undefined ? {} : { recovery }), ...(script === undefined ? {} : { script }) }, {}, { cause: error })
}
