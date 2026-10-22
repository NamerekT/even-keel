import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import type { AccountHome } from '../../src/account/homes.js'
import { addRuleText, addRuleVersion, emptyRuleRows, type RuleRows } from './rule-parse.js'
import { MAX_CLAUDE_JSON_BYTES, PROJECT_SPECS, textOf } from './rule-scan.js'
import { ruleFileOf } from './rules.js'

const run = promisify(execFile)
const CLAUDE_MD_BACKUP = /^CLAUDE\.md\..+\.bak$|^CLAUDE \(backup\)\.md$/i
const CLAUDE_JSON_BACKUP = /^\.claude\.json\.(?:backup|corrupted)\.(\d{10,})$/

export interface Backup {
  target: 'CLAUDE.md' | '.claude.json'
  at: string | null
}

export interface GitCommit {
  sha: string
  at: string
  files: { path: string; deleted: boolean }[]
}

export function transcriptSession(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts.at(-2) === 'subagents' ? parts.at(-3)! : parts.at(-1)!.replace(/\.jsonl$/, '')
}

// A null time means the backup's own mtime.
export function backupOf(name: string): Backup | null {
  if (CLAUDE_MD_BACKUP.test(name)) return { target: 'CLAUDE.md', at: null }
  const match = CLAUDE_JSON_BACKUP.exec(name)
  return match === null ? null : { target: '.claude.json', at: new Date(Number(match[1])).toISOString() }
}

// Output of `git log --format=%x00%H %cI --name-status`.
export function parseGitLog(out: string): GitCommit[] {
  const commits: GitCommit[] = []
  for (const chunk of out.split('\u0000')) {
    const [head, ...lines] = chunk.split('\n')
    const [sha, date] = (head ?? '').trim().split(' ')
    if (!sha || !date) continue
    const files = lines
      .map((line) => line.split('\t'))
      .filter((fields) => fields.length === 2 && fields[1] !== '')
      .map(([status, path]) => ({ path: path!, deleted: status === 'D' }))
    commits.push({ sha, at: new Date(date).toISOString(), files })
  }
  return commits
}

// Older CLAUDE.md and .claude.json versions the CLI left in each account folder's backups.
export async function backupVersions(homes: AccountHome[], home: string): Promise<RuleRows> {
  const rows = emptyRuleRows()
  for (const account of homes) {
    const dir = join(account.dir, 'backups')
    const paths = [...(await readdir(dir).catch(() => [] as string[])).map((name) => join(dir, name)), join(account.dir, 'CLAUDE (backup).md')]
    for (const path of paths) {
      const backup = backupOf(basename(path))
      if (backup === null) continue
      const target = backup.target === 'CLAUDE.md' ? join(account.dir, 'CLAUDE.md') : account.global ? join(home, '.claude.json') : join(account.dir, '.claude.json')
      const file = ruleFileOf(target, home)
      const info = await stat(path).catch(() => null)
      if (file === null || info === null || !info.isFile() || info.size > MAX_CLAUDE_JSON_BYTES) continue
      const content = textOf(file, await readFile(path, 'utf8'))
      if (content === null) continue
      const at = backup.at ?? info.mtime.toISOString()
      addRuleVersion(rows, file, { at, hash: addRuleText(rows, file, content), source: 'backup', ref: basename(path) })
    }
  }
  return rows
}

// Rule file versions on the project's branch since the last read head (first parent only: a merge lands at its own time).
export async function gitVersions(repo: string, branch: string, home: string, known: string | null): Promise<{ head: string; rows: RuleRows }> {
  const git = async (args: string[]) => (await run('git', ['-C', repo, ...args], { maxBuffer: 64 * 1024 * 1024 })).stdout
  const ref = `refs/heads/${branch}`
  const head = (await git(['rev-parse', '--verify', ref])).trim()
  const rows = emptyRuleRows()
  if (head === known) return { head, rows }
  const range = known === null ? ref : `${known}..${ref}`
  const log = await git(['log', '--first-parent', '--diff-merges=first-parent', '--no-renames', '--name-status', '--format=%x00%H %cI', range, '--', ...PROJECT_SPECS])
  for (const commit of parseGitLog(log)) {
    for (const change of commit.files) {
      const file = ruleFileOf(join(repo, change.path), home)
      if (file === null) continue
      let hash: string | null = null
      if (!change.deleted) {
        const content = textOf(file, await git(['show', `${commit.sha}:${change.path}`]))
        if (content === null) continue
        hash = addRuleText(rows, file, content)
      }
      addRuleVersion(rows, file, { at: commit.at, hash, source: 'git', ref: commit.sha })
    }
  }
  return { head, rows }
}
