import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { audit, markdown } from './unverified-audit.js'

describe('unverified audit on git history', () => {
  let root: string
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  const put = (file: string, text: string) => {
    mkdirSync(dirname(resolve(root, file)), { recursive: true })
    writeFileSync(resolve(root, file), text)
  }
  const commit = (day: number, subject: string) => {
    git('add', '.')
    const date = `2025-01-${String(day).padStart(2, '0')}T12:00:00Z`
    execFileSync('git', ['commit', '-qm', subject], {
      cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    })
  }
  beforeAll(() => {
    mkdirSync('.temp', { recursive: true })
    root = mkdtempSync(resolve('.temp/unverified-audit-'))
    git('init', '-q')
    git('config', 'user.name', 'Test Author')
    git('config', 'user.email', 'test@example.com')
    git('config', 'core.autocrlf', 'false')
    put('src/feature.ts', 'export const existingName = 1\n')
    put('src/notice/en.ts', "export const en = { 'statusMove.failed': 'old', 'statusMoves.old': 'old', 'statusMove.removed': 'old' }\n")
    put('src/only.test.ts', 'old\n')
    put('docs/other.md', 'old\n')
    put('plugins/example/SKILL.md', 'old\n')
    put('test/fixtures/sample.ts', 'old\n')
    commit(1, '[BTN-1] Original feature')
    const headings = ['Changed (BTN-1)', 'Acknowledged (BTN-1)', 'Fresh (BTN-1)', 'Unknown (EKR-99)', 'Bloated', 'Missing', 'Quiet', 'Shared (BTN-3)', 'Words']
    const bodies = [
      '`statusMove.failed` and `existingName`.\n```ts\n## Not an entry\nRemovedInFence\n```',
      '<!-- checked against: BTN-2, BTN-3 -->\nStill open.',
      'Still open.', 'No matching commit.',
      '2024-01-01 2024-01-02 2024-01-03',
      '`MissingSymbol` `Vanished` `src/gone.ts` `statusMove.removed` `settings.unknown` `--bg` `true` `123456` `run command` `<SomeType>` `other-repo/x.ts` `plugins/*.test.mjs` `plugins/?.test.mjs`',
      '`existingName` `src/feature.ts`', '`src/notice/en.ts`', 'word '.repeat(400),
    ]
    put('docs/unverified/area.md', '# Area\n\n' + headings.map((h, i) => `## ${h}\n\n${bodies[i]}\n\n`).join(''))
    put('docs/unverified.md', '## What to check first\n### Then\n' +
      headings.slice(0, -1).map((h, i) => `| ${i + 1} | [Entry](unverified/area.md#${h.toLowerCase().replace(/[()]/g, '').replaceAll(' ', '-')}) | users | risk | BTN-90 |`).join('\n') +
      '\n| 99 | [Gone](unverified/area.md#gone) | users | risk | — |\n')
    commit(2, 'Record entries')
    put('src/feature.ts', 'export const existingName = 2\n')
    for (let i = 0; i < 31; i++) put(`src/bulk-${i}.ts`, 'export {}\n')
    commit(3, '[BTN-2] Broad rename | retained')
    put('src/notice/en.ts', "export const en = { 'statusMove.failed': 'old', 'statusMoves.old': 'old', 'statusMoves.new': 'new', 'unrelated.new': 'new' }\n")
    commit(4, '[BTN-3] Add sibling notice')
    put('src/feature.ts', 'export const existingName = 3\n')
    commit(5, 'Live check without a task')
    put('src/only.test.ts', 'new\n')
    put('docs/other.md', 'new\n')
    put('plugins/example/SKILL.md', 'new\n')
    put('test/fixtures/sample.ts', 'new\n')
    commit(6, '[BTN-4] Tests and docs only')
    const area = readFileSync(resolve(root, 'docs/unverified/area.md'), 'utf8')
    put('docs/unverified/area.md', area.replace('## Fresh (BTN-1)\n\nStill open.', '## Fresh (BTN-1)\n\nUpdated after the changes.'))
    commit(7, 'Narrow just one entry')
    put('src/feature.ts', 'export const existingName = 4\n')
    commit(8, '[BTN-2] Same task touches the feature again')
    put('src/notice/en.ts', readFileSync(resolve(root, 'src/notice/en.ts'), 'utf8') + '// Shared change\n')
    commit(8, '[EKR-5] Shared notice change')
    // Forty distinct tasks: feature.ts is exactly 5%, notices are above it.
    // Import empty task commits together to avoid 35 process launches on Windows.
    const ref = git('symbolic-ref', 'HEAD').trim()
    const parent = git('rev-parse', 'HEAD').trim()
    const input = Array.from({ length: 35 }, (_, i) => {
      const subject = `[BTN-${i + 6}] No code changes`
      return `commit ${ref}\ncommitter Test Author <test@example.com> 1735732800 +0000\ndata ${subject.length}\n${subject}\n${i === 0 ? `from ${parent}\n` : ''}\n`
    }).join('')
    execFileSync('git', ['fast-import', '--quiet'], { cwd: root, input })
  }, 30_000)
  afterAll(() => {
    if (root && root.startsWith(resolve('.temp') + sep)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('finds all four signals, dates each section and leaves the repository untouched', () => {
    const before = git('status', '--porcelain')
    const result = audit(root)
    const byId = (id: string) => result.entries.find((entry) => entry.id === id)!
    expect(result.entries).toHaveLength(9)
    expect(byId('1').a.commits.map((c) => c.task)).toEqual(['BTN-2', 'BTN-2'])
    expect(byId('1').files).toEqual(['src/feature.ts'])
    expect(byId('1').a.commits.some((c) => c.massive)).toBe(true)
    expect(byId('1').date).toBe(Date.parse('2025-01-02T12:00:00Z') / 1000)
    expect(byId('2').a.commits).toEqual([])
    expect(byId('3').a.commits.map((c) => c.task)).toEqual(['BTN-2'])
    expect(byId('3').date).toBe(Date.parse('2025-01-07T12:00:00Z') / 1000)
    expect(byId('4').a.unknown).toEqual(['EKR-99'])
    expect(byId('5').b).toEqual({ words: 3, dates: 3 })
    expect(result.entries.find((entry) => entry.id === '?')!.b).toEqual({ words: 400, dates: 0 })
    expect(byId('1').c).toEqual(['statusMoves.new'])
    expect(result.entries.filter((entry) => entry.c.length).map((entry) => entry.id)).toEqual(['1'])
    expect(byId('6').d).toEqual(['MissingSymbol', 'Vanished', 'src/gone.ts', 'statusMove.removed'])
    expect(result.entries.filter((entry) => entry.d.length).map((entry) => entry.id)).toEqual(['6'])
    expect(byId('7').a.commits.map((commit) => commit.task)).toEqual(['BTN-2', 'BTN-2'])
    expect(byId('7').d).toEqual([])
    expect(byId('7').b).toBeUndefined()
    expect(result.missingEntries.map((r) => r.id)).toEqual(['99'])
    expect(result.missingIds.map((e) => e.heading)).toEqual(['Words'])
    const report = markdown(result)
    expect(report).toContain('BTN-2')
    expect(report).toContain('massive change, likely a rename')
    expect(report).toContain('unknown: EKR-99')
    expect(report).toContain('Broad rename &#124; retained')
    expect(report).toContain('name disappeared:')
    expect(report).toContain('| BTN-90 |')
    expect(report.indexOf('| 1 |')).toBeLessThan(report.indexOf('| 5 |'))
    expect(git('status', '--porcelain')).toBe(before)
  }, 30_000)

  it('reports shared files and marks entries left without A files, without making them candidates', () => {
    const result = audit(root)
    const shared = result.entries.find((entry) => entry.id === '8')!
    expect(shared.files).toEqual([])
    expect(shared.a.commits).toEqual([])
    expect(shared.a.unknown).toEqual([])
    const report = markdown(result)
    expect(report).toContain('9 entries; 7 candidates.')
    expect(report).toContain('src/notice/en.ts 8%')
    expect(report.indexOf('src/notice/en.ts 8%')).toBeLessThan(report.indexOf('| ID |'))
    expect(report).toContain('| 8 | docs/unverified/area.md#shared-btn-3 | only shared files |')
  }, 30_000)
})
