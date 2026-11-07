import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import type { AgentEntry } from '../sessions/agents.js'
import { projectDirName } from '../sessions/paths.js'
import { FolderCalls, type CallOutput } from './calls.js'
import { ClaudeCli } from './cli.js'

vi.mock('node:child_process', () => ({ execFile: vi.fn(), spawn: vi.fn() }))
let home: AccountHome

beforeEach(async () => {
  await mkdir('.temp', { recursive: true })
  const dir = await mkdtemp(resolve('.temp', 'rare-claude-'))
  home = { key: 'global', dir, global: true, agent: 'claude' }
})
afterEach(async () => { vi.restoreAllMocks(); await rm(home.dir, { recursive: true, force: true }) })

describe('rare Claude observations', () => {
  it.each(['expected', 'other-folder', 'missing'])('logs the actual copied resume and transcript presence (%s)', async (transcript) => {
    vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: null, stdout: string, stderr: string) => void
      callback(null, '', '')
      return {} as ReturnType<typeof execFile>
    })
    const cli = new ClaudeCli(() => process.execPath, 1000, () => ({}))
    const found: AgentEntry = { id: 'new-job', sessionId: home.dir, name: 'ABC-1', cwd: home.dir, kind: 'bg', startedAt: Date.now() }
    // A real id without path separators also makes the expected transcript path unambiguous.
    found.sessionId = home.dir.split(/[\\/]/).at(-1)!
    vi.spyOn(cli, 'agents').mockResolvedValue([found])
    if (transcript !== 'missing') {
      const folder = join(home.dir, 'projects', transcript === 'expected' ? projectDirName(found.cwd) : 'previous-location')
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, `${found.sessionId}.jsonl`), '')
    }
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const resumed = await cli.resume(home, 'old-job', 'old-session', 'ABC-1', home.dir, 'continue', null)
    expect(resumed.sessionId).toBe(found.sessionId)
    const rare = log.mock.calls.filter(([line]) => String(line).startsWith('rare: 18'))
    expect(rare).toHaveLength(1)
    expect(rare[0]![0]).toContain(`oldSession="old-session" transcript=${transcript !== 'missing'}`)
  })

  it.each(['blocked', 'working', 'invalid', 'missing'])('reads background block details only from a blocked CLI end (%s)', async (state) => {
    const agent: AgentEntry = { id: 'job', sessionId: 'session', cwd: '/repo', kind: 'bg', startedAt: 0, pid: 1234, status: 'shell', state: 'blocked' }
    class Listing extends FolderCalls {
      override run(): Promise<CallOutput> { return Promise.resolve({ stdout: JSON.stringify([agent]), stderr: '' }) }
    }
    const cli = new ClaudeCli(() => 'unused', 1000, () => ({}), new Listing())
    await mkdir(join(home.dir, 'jobs', 'job'), { recursive: true })
    if (state !== 'missing') await writeFile(join(home.dir, 'jobs', 'job', 'state.json'), state === 'invalid' ? '{' : JSON.stringify({
      state, updatedAt: 123, detail: 'Press the button',
    }))
    const [found] = await cli.agents(home)
    expect(found?.backgroundBlock).toEqual(state === 'blocked' ? { event: '["job",123,"Press the button"]', detail: 'Press the button' } : undefined)
  })
})
