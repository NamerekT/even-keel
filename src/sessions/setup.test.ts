import { describe, expect, it } from 'vitest'
import { NoticeError } from '../notice/notice.js'
import type { AccountHome } from '../account/homes.js'
import { accountEnv, runAfterGreen, runBeforeStart, type Shell } from './setup.js'

function shell(results: Record<string, { code: number; out: string }>) {
  const calls: { command: string; cwd: string }[] = []
  const run: Shell = async (command, cwd) => {
    calls.push({ command, cwd })
    return results[command] ?? { code: 0, out: '' }
  }
  return { run, calls }
}

describe('runBeforeStart', () => {
  it('runs the commands in order in the task folder and logs their output', async () => {
    const { run, calls } = shell({ 'npm ci': { code: 0, out: 'added 12 packages\nfound 0 vulnerabilities' } })
    const log: string[] = []
    await runBeforeStart(['npm ci', 'npm run build'], { task: 'ABC-1', cwd: 'D:/repo/.claude/worktrees/abc-1', shell: run, log: (line) => log.push(line) })
    expect(calls).toEqual([
      { command: 'npm ci', cwd: 'D:/repo/.claude/worktrees/abc-1' },
      { command: 'npm run build', cwd: 'D:/repo/.claude/worktrees/abc-1' },
    ])
    expect(log[0]).toBe('setup: ABC-1: npm ci in D:/repo/.claude/worktrees/abc-1')
    expect(log).toContain('setup: ABC-1: | added 12 packages')
    expect(log).toContain('setup: ABC-1: | found 0 vulnerabilities')
  })

  it('stops at a failed command with its code and the tail of its output', async () => {
    const out = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join('\n')
    const { run, calls } = shell({ 'npm ci': { code: 1, out } })
    const failure = await runBeforeStart(['npm ci', 'npm run build'], { task: 'ABC-1', cwd: 'D:/w', shell: run, log: () => {} }).catch(
      (error: unknown) => error,
    )
    expect(calls).toHaveLength(1)
    expect(failure).toBeInstanceOf(NoticeError)
    const { notice } = failure as NoticeError
    expect(notice.code).toBe('setup.failed')
    expect(notice.params).toEqual({ task: 'ABC-1', command: 'npm ci', code: 1 })
    expect(notice.detail?.split('\n')[0]).toBe('line 21')
    expect(notice.detail).toContain('line 60')
  })

  it('does nothing without commands', async () => {
    const { run, calls } = shell({})
    await runBeforeStart([], { task: 'ABC-1', cwd: 'D:/w', shell: run, log: () => {} })
    expect(calls).toEqual([])
  })
})

describe('runAfterGreen', () => {
  it('runs the commands in order in the project checkout and returns the first failure with the output in the log', async () => {
    const { run, calls } = shell({ 'npm run build': { code: 2, out: 'error TS2304' } })
    const log: string[] = []
    const failure = await runAfterGreen(['npm ci', 'npm run build', 'pwsh -File restart.ps1'], { task: 'ABC', cwd: 'D:/repo', shell: run, log: (line) => log.push(line) })
    expect(calls.map((call) => call.command)).toEqual(['npm ci', 'npm run build'])
    expect(failure).toEqual({ command: 'npm run build', code: 2, output: 'error TS2304' })
    expect(log).toEqual(['afterGreen: ABC: npm ci in D:/repo', 'afterGreen: ABC: npm run build in D:/repo', 'afterGreen: ABC: | error TS2304'])
  })
})

describe('accountEnv', () => {
  const codex: AccountHome = { key: 'codex', dir: 'C:/Users/john/.codex', global: true, agent: 'codex' }
  const homes = new Map([[codex.key, codex]])
  const envOf = (home: AccountHome) => ({ PATH: 'C:/bin', [home.agent === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR']: home.dir })

  it('is the environment of the account the task runs on, with no Claude folder needed', () => {
    expect(accountEnv('codex', (key) => homes.get(key), envOf, { PATH: 'C:/bin' })).toEqual({ PATH: 'C:/bin', CODEX_HOME: 'C:/Users/john/.codex' })
  })

  it("is the service's own environment while the account has no folder", () => {
    expect(accountEnv('global', (key) => homes.get(key), envOf, { PATH: 'C:/bin' })).toEqual({ PATH: 'C:/bin' })
  })
})
