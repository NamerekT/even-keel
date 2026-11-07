import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodexCli } from './cli.js'
import { CodexPlugins } from './plugins.js'
import { polledProcessStartedAt } from './process.js'
import { TurnRegistry } from './turns.js'

vi.mock('./process.js', async (original) => ({ ...await original<typeof import('./process.js')>(), polledProcessStartedAt: vi.fn() }))
vi.mock('../agent/process.js', () => ({ isAlive: () => true, killTree: vi.fn() }))

let dir: string
beforeEach(async () => {
  await mkdir('.temp', { recursive: true })
  dir = await mkdtemp(join('.temp', 'rare-codex-'))
})
afterEach(async () => { vi.restoreAllMocks(); await rm(dir, { recursive: true, force: true }) })

describe('a last-turn pid reused by another process', () => {
  it.each([70_001, 60_000, undefined])('reports only a confirmed mismatch (%s), once per turn', async (startedAt) => {
    const out = join(dir, 'ABC-1-10000.jsonl')
    await writeFile(out, '{"type":"turn.started"}\n')
    const registry = new TurnRegistry(dir)
    registry.save({ sessionId: dir.replace(/[^\w-]/g, '-'), name: 'ABC-1', cwd: '/repo', account: 'global', startedAt: 1, pid: 1234, out })
    const cli = new CodexCli(() => 'unused', 1000, () => ({}), registry, {} as CodexPlugins)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.mocked(polledProcessStartedAt).mockResolvedValue(startedAt)
    const first = await cli.sessions({ key: 'global', dir, global: true, agent: 'codex' })
    await cli.sessions({ key: 'global', dir, global: true, agent: 'codex' })
    expect(first[0]?.status).toBe(startedAt === 70_001 ? 'idle' : 'busy')
    const rare = () => log.mock.calls.filter(([line]) => String(line).startsWith('rare: 29'))
    expect(rare()).toHaveLength(startedAt === 70_001 ? 1 : 0)
    if (startedAt === 70_001) {
      expect(rare()[0]![0]).toContain('pid=1234 turnAt=10000 processAt=70001')
      await writeFile(out, '{"type":"turn.completed"}\n')
      await cli.sessions({ key: 'global', dir, global: true, agent: 'codex' })
      expect(rare()).toHaveLength(1)
    }
  })
})
