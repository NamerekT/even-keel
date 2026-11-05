import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import { noticeOf } from '../notice/notice.js'
import { ClaudeCli } from './cli.js'

vi.mock('node:child_process', () => ({ execFile: vi.fn(), spawn: vi.fn() }))
vi.mock('node:fs', async (original) => ({ ...await original<typeof import('node:fs')>(), existsSync: vi.fn() }))
afterEach(() => vi.resetAllMocks())

describe('failed Claude invocation snapshot', () => {
  it.each(['launch', 'resume'] as const)('captures the spawned binary and account before %s fails', async (method) => {
    const home: AccountHome = { key: 'one', dir: resolve('.temp/accounts/one'), global: false, agent: 'claude' }
    const env = { CLAUDE_CONFIG_DIR: home.dir }
    let binary = process.execPath
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
      binary = 'D:/changed/claude.exe'
      env.CLAUDE_CONFIG_DIR = 'D:/accounts/other'
      const callback = args.at(-1) as (error: Error, stdout: string, stderr: string) => void
      callback(Object.assign(new Error('refused'), { stderr: 'Workspace not trusted' }), '', 'Workspace not trusted')
      return {} as ReturnType<typeof execFile>
    })
    const cli = new ClaudeCli(() => binary, 1000, () => env)
    const call = method === 'launch' ? cli.launch(home, 'ABC-1', 'D:/repo', 'test', null) : cli.resume(home, 'job', 'session', 'ABC-1', 'D:/repo', 'test', null)
    const error = await call.catch(error => error)
    expect(noticeOf(error)).toMatchObject({ params: { recovery: { binary: process.execPath, configDir: home.dir } } })
  })

  it.each([undefined, '', '../account'])('normalizes account override %s for a recovery terminal', async (configDir) => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error, stdout: string, stderr: string) => void
      callback(new Error('Workspace not trusted'), '', '')
      return {} as ReturnType<typeof execFile>
    })
    const cwd = resolve('.temp/repo')
    const cli = new ClaudeCli(() => process.execPath, 1000, () => ({ CLAUDE_CONFIG_DIR: configDir }))
    const error = await cli.launch({ key: 'global', dir: 'D:/global', agent: 'claude', global: true }, 'ABC-1', cwd, 'test', null).catch(error => error)
    expect(noticeOf(error)).toMatchObject({ params: { recovery: { configDir: configDir ? resolve(cwd, configDir) : null } } })
  })
})
