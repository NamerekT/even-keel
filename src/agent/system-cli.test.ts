import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ copies: '', ran: [] as string[] }))

/** Every copy under `cli/` of the work folder counts as downloaded; nothing else is. */
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  const existsSync = (path: import('node:fs').PathLike) => (state.copies !== '' && String(path).startsWith(state.copies)) || fs.existsSync(path)
  return { ...fs, existsSync, default: { ...fs, existsSync } }
})
vi.mock('node:child_process', async (original) => {
  const child = await original<typeof import('node:child_process')>()
  const execFile = (file: string, _args: unknown, _options: unknown, done: (error: null, result: { stdout: string; stderr: string }) => void) => {
    state.ran.push(file)
    done(null, { stdout: '9.9.9\n', stderr: '' })
  }
  return { ...child, execFile, default: { ...child, execFile } }
})
vi.mock('../paths.js', async (original) => ({ ...await original<typeof import('../paths.js')>(), findBinary: (bin: string) => bin.startsWith(state.copies) }))

const { AGENTS } = await import('./adapters.js')

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cli-system-'))
  state.copies = join(dir, 'cli')
  state.ran = []
})

afterEach(async () => {
  state.copies = ''
  await rm(dir, { recursive: true, force: true })
})

describe('the CLI on the machine', () => {
  it.each(Object.entries(AGENTS))('%s is asked apart from the checked copy sessions run on', async (_name, adapter) => {
    const agent = adapter.setup({ env: () => ({ PATH: '' }), workDir: dir, timeoutMs: 100, checkedCli: () => true, log: () => {}, onCliChange: () => {} })
    expect(agent.installed?.()).toBe(true)
    expect(agent.system?.installed()).toBe(false)

    await agent.version!()
    await agent.system!.version()
    expect(state.ran[0]!.startsWith(state.copies)).toBe(true)
    expect(state.ran[1]!.startsWith(state.copies)).toBe(false)
  })
})
