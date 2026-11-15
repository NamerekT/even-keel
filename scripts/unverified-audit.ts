import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { entries, indexRows, type Entry, type Row } from './unverified-entries.js'

// Tune these candidate thresholds during audits, not as automatic editing rules.
const WORD_THRESHOLD = 400
const DATE_THRESHOLD = 3
const MASSIVE_FILES = 30
const HUB_SHARE = 0.05
const NOTICE_FILE = 'src/notice/en.ts'
const SEARCH_ROOTS = ['src', 'web/src', 'tally/src', 'plugins', 'scripts']
const taskIds = (text: string): string[] => [...new Set(text.match(/\b(?:BTN|EKR)-\d+\b/g) ?? [])]
const codeFile = (file: string): boolean => /^(src|web\/src|tally\/src|plugins)\//.test(file)
  && /\.(?:[cm]?[jt]sx?|json|css|scss|html|sh|ps1|py|sql)$/.test(file) && !file.endsWith('.test.ts')
const key = (entry: { file: string; anchor: string }): string => `${entry.file}#${entry.anchor}`

interface Commit {
  hash: string
  time: number
  subject: string
  task?: string
  files: string[]
  massive: boolean
}
export interface Finding extends Entry {
  id: string
  task: string
  date: number
  files: string[]
  a: { commits: Commit[]; unknown: string[]; onlyShared: boolean }
  b?: { words: number; dates: number }
  c: string[]
  d: string[]
}
interface Audit {
  entries: Finding[]
  sharedFiles: { file: string; share: number }[]
  missingIds: Entry[]
  missingEntries: Row[]
}

export function audit(root: string): Audit {
  const git = (...args: string[]): string => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  })
  const read = (file: string) => readFileSync(join(root, file), 'utf8')
  // One history read keeps task lookup and whole-commit sizes cheap even for large journals.
  const history: Commit[] = git('-c', 'core.quotePath=false', 'log', '--no-merges', '--format=%x1e%H%x1f%ct%x1f%s', '--name-only')
    .split('\x1e').filter((part) => part.trim()).map((part) => {
      const [head, ...lines] = part.trim().split('\n')
      const [hash, time, subject] = head!.split('\x1f')
      const files = lines.map((line) => line.trim()).filter(Boolean)
      return { hash: hash!, time: Number(time), subject: subject!, task: subject!.match(/\[((?:BTN|EKR)-\d+)\]/)?.[1], files, massive: files.length > MASSIVE_FILES }
    })
  const historyTasks = new Set<string>()
  const fileTasks = new Map<string, Set<string>>()
  for (const commit of history) {
    const tasks = [...commit.subject.matchAll(/\[((?:BTN|EKR)-\d+)\]/g)].map((match) => match[1]!)
    for (const task of tasks) historyTasks.add(task)
    for (const file of commit.files.filter(codeFile)) {
      if (!tasks.length) continue
      const touched = fileTasks.get(file) ?? new Set<string>()
      for (const task of tasks) touched.add(task)
      fileTasks.set(file, touched)
    }
  }
  const sharedFiles = [...fileTasks].map(([file, tasks]) => ({ file, share: tasks.size / historyTasks.size }))
    .filter(({ share }) => share > HUB_SHARE)
    .sort((a, b) => b.share - a.share || a.file.localeCompare(b.file))
  const shared = new Set(sharedFiles.map(({ file }) => file))
  const rows = indexRows(read('docs/unverified.md'))
  const sections = entries(join(root, 'docs'))
  const notices = new Set([...read(NOTICE_FILE).matchAll(/['"]([\w]+(?:\.[\w]+)+)['"]\s*:/g)].map((match) => match[1]!))
  let historicalNotices: Set<string> | undefined
  const wasNotice = (code: string): boolean => {
    historicalNotices ??= new Set([...git('log', '--format=', '-p', '--', NOTICE_FILE)
      .matchAll(/['"]([\w]+(?:\.[\w]+)+)['"]\s*:/g)].map((match) => match[1]!))
    return historicalNotices.has(code)
  }
  const noticeDates = new Map<string, number | undefined>()
  const firstMention = (code: string): number | undefined => {
    if (!noticeDates.has(code)) {
      const times = git('log', `-S${code}`, '--format=%at', '--', NOTICE_FILE).trim().split('\n').filter(Boolean).map(Number)
      noticeDates.set(code, times.length ? Math.min(...times) : undefined)
    }
    return noticeDates.get(code)
  }
  const foundNames = new Map<string, boolean>()
  const present = (name: string): boolean => {
    if (!foundNames.has(name)) {
      const result = spawnSync('git', ['grep', '-F', '-q', '-e', name, '--', ...SEARCH_ROOTS], { cwd: root, encoding: 'utf8' })
      if (result.error) throw result.error
      if (result.status !== 0 && result.status !== 1) throw new Error(`git grep failed: ${result.stderr}`)
      foundNames.set(name, result.status === 0)
    }
    return foundNames.get(name)!
  }
  const findings: Finding[] = sections.map((entry) => {
    const row = rows.find((row) => key(row) === key(entry))
    const blame = git('blame', '--porcelain', '-L', `${entry.start},${entry.end}`, '--', `docs/unverified/${entry.file}`)
    const times = [...blame.matchAll(/^author-time (\d+)$/gm)].map((match) => Number(match[1]))
    const date = Math.max(...times)
    if (!Number.isFinite(date)) throw new Error(`No blame date for ${key(entry)}`)
    const text = `${entry.heading}\n${entry.body}`
    const tasks = taskIds(text)
    const tokens = [...new Set([...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]!))]
    const files = new Set<string>()
    const unknown: string[] = []
    for (const task of tasks) {
      const commits = history.filter((commit) => commit.subject.includes(`[${task}]`))
      if (!commits.length) unknown.push(task)
      for (const commit of commits) for (const file of commit.files) if (codeFile(file)) files.add(file)
    }
    for (const token of tokens) {
      if (codeFile(token) && existsSync(join(root, token)) && statSync(join(root, token)).isFile()) files.add(token)
    }
    const hadFiles = files.size > 0
    for (const file of shared) files.delete(file)
    const onlyShared = hadFiles && files.size === 0
    const acknowledged = taskIds([...text.matchAll(/<!--\s*checked against:([\s\S]*?)-->/g)].map((match) => match[1]).join(' '))
    const excluded = new Set([...tasks, ...acknowledged])
    const commits = history.filter((commit) => commit.time > date && commit.task && !excluded.has(commit.task) && commit.files.some((file) => files.has(file)))
    const body = entry.body.replace(/<!--[\s\S]*?-->/g, '')
    const words = body.trim().split(/\s+/).filter(Boolean).length
    const dates = (body.match(/20\d\d-\d\d-\d\d/g) ?? []).length
    const prefix = (code: string) => code.slice(0, code.lastIndexOf('.'))
    const mentioned = tokens.filter((token) => notices.has(token))
    const c = [...notices].filter((code) => !tokens.includes(code) && mentioned.some((token) => {
      const a = prefix(token), b = prefix(code)
      return a === b || a === `${b}s` || b === `${a}s`
    }) && (firstMention(code) ?? 0) > date)
    const d = tokens.filter((token) => {
      if (/\s|[<>*?]/.test(token) || token.startsWith('-')) return false
      if (token.includes('/') && /\.[a-z\d]+$/i.test(token)) {
        if (!existsSync(join(root, token.split('/')[0]!))) return false
        return !existsSync(join(root, token)) && !present(token)
      }
      if (/^\w+(?:\.\w+)+$/.test(token)) {
        // A dotted config key is not a missing notice: require evidence from notice history.
        return !notices.has(token) && wasNotice(token) && !present(token)
      }
      return token.length > 5 && /^[A-Za-z][A-Za-z\d]*$/.test(token) && /[a-z][A-Z]|^[A-Z][a-z]/.test(token) && !present(token)
    })
    return { ...entry, id: row?.id ?? '?', task: row?.task ?? '—', date, files: [...files].sort(), a: { commits, unknown, onlyShared },
      b: words >= WORD_THRESHOLD || dates >= DATE_THRESHOLD ? { words, dates } : undefined, c, d }
  })
  return { entries: findings, sharedFiles, missingIds: sections.filter((entry) => !rows.some((row) => key(row) === key(entry))),
    missingEntries: rows.filter((row) => !sections.some((entry) => key(row) === key(entry))) }
}

export function markdown(report: Audit): string {
  const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('|', '&#124;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replace(/[\r\n]/g, ' ')
  const signals = (entry: Finding) => Number(entry.a.commits.length > 0) + Number(Boolean(entry.b)) + Number(entry.c.length > 0) + Number(entry.d.length > 0)
  const candidates = report.entries.filter((entry) => signals(entry) || entry.a.unknown.length)
  const rows = report.entries.filter((entry) => signals(entry) || entry.a.unknown.length || entry.a.onlyShared)
    .sort((a, b) => Number(b.a.commits.length > 0) - Number(a.a.commits.length > 0) || signals(b) - signals(a) || key(a).localeCompare(key(b)))
  const lines = ['# Unverified audit', '', `${report.entries.length} entries; ${candidates.length} candidates. Read-only signals, not proof of changed behaviour.`, '',
    `Shared files (excluded from A): ${report.sharedFiles.map(({ file, share }) => `${escape(file)} ${Math.round(share * 100)}%`).join(', ') || 'none'}.`, '',
    'A: later task commits touching the entry\'s code; unknown means task history was not found. Rows with only shared files are also shown, but that alone is not a candidate. B: body words/dates. C: newer sibling notices. D: names no longer found.', '',
    '| ID | File#anchor | A | B (words/dates) | C | D | Task |', '| --- | --- | --- | --- | --- | --- | --- |']
  for (const entry of rows) {
    const a = entry.a.commits.map((commit) => `${commit.hash.slice(0, 8)} ${escape(commit.subject)}${commit.massive ? ' (massive change, likely a rename)' : ''}`)
    if (entry.a.onlyShared) a.push('only shared files')
    if (entry.a.unknown.length) a.push(`unknown: ${entry.a.unknown.join(', ')}`)
    lines.push(`| ${entry.id} | docs/unverified/${key(entry)} | ${a.join('<br>') || '—'} | ${entry.b ? `${entry.b.words}/${entry.b.dates}` : '—'} | ${entry.c.map(escape).join(', ') || '—'} | ${entry.d.length ? `name disappeared: ${entry.d.map(escape).join(', ')}` : '—'} | ${entry.task} |`)
  }
  lines.push('', '## Entries without an index ID', '', ...report.missingIds.map((entry) => `- docs/unverified/${key(entry)}`))
  if (!report.missingIds.length) lines.push('None.')
  lines.push('', '## Index rows without an entry', '', ...report.missingEntries.map((row) => `- ${row.id}: docs/unverified/${key(row)}`))
  if (!report.missingEntries.length) lines.push('None.')
  return lines.join('\n') + '\n'
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.stdout.write(markdown(audit(process.cwd()))) }
  catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 }
}
