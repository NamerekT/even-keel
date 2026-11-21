import { notice, type Notice } from '../notice/notice.js'

/**
 * The files whose change acts outside the session (BTN-1207): a CI workflow runs on the push of the branch with the
 * repository's secrets, and the agent's settings, hooks, skills and rules are run by the next sessions of the chain
 * once merged; `package.json` scripts run on an install. A branch of an outsider's task that changes one waits for a
 * person before its merge and before its push for a pull request.
 */
const ROOT_FOLDERS = ['.github/workflows/', '.forgejo/workflows/', '.gitea/workflows/']
const ROOT_FILES = ['.gitlab-ci.yml']
const ANY_LEVEL_FOLDERS = ['.claude', '.codex']
const ANY_LEVEL_FILES = ['CLAUDE.md', 'AGENTS.md', 'package.json']

/** Of a branch's changed files, relative to the repository's root, those an outsider's task may not land by itself. */
export function guardedFiles(files: readonly string[]): string[] {
  return files.filter((file) => {
    const path = file.trim().replace(/\\/g, '/').replace(/^\.\//, '')
    const parts = path.split('/')
    const name = parts.at(-1) ?? ''
    if (ROOT_FOLDERS.some((folder) => path.startsWith(folder)) || ROOT_FILES.includes(path)) return true
    return ANY_LEVEL_FILES.includes(name) || parts.slice(0, -1).some((part) => ANY_LEVEL_FOLDERS.includes(part))
  })
}

/** The merge hook's body `{ files }`: the branch's changed files; `null` — not a list of paths. */
export function filesOf(body: unknown): string[] | null {
  const files = typeof body === 'object' && body !== null ? (body as { files?: unknown }).files : undefined
  return Array.isArray(files) && files.every((file) => typeof file === 'string' && file !== '') ? files : null
}

/** How many of the files the text names; the detail under it has them all. */
const FILES_SHOWN = 3

/**
 * The pause of the chain on such a branch: `pull` — before its push for a pull request, else before its merge. No
 * files — git could not tell them, and `failure` is what it said.
 */
export function outsiderHold(task: string, files: readonly string[], pull: boolean, failure?: string): Notice {
  const shown = files.slice(0, FILES_SHOWN)
  const detail = files.length > shown.length ? files.join('\n') : failure
  const params = { task, files: shown, more: files.length - shown.length, ...(pull ? { pull: true as const } : {}) }
  return notice('review.outsiderFiles', params, detail === undefined || detail.trim() === '' ? {} : { detail })
}
