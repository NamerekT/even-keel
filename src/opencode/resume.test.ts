import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { TurnRegistry } from '../codex/turns.js'
import { NoticeError } from '../notice/notice.js'
import { OpenCodeCli, silentTurnDetail } from './cli.js'

const roots: string[] = []
const pids: number[] = []

afterEach(() => {
  for (const pid of pids.splice(0)) try { process.kill(pid) } catch { /* already gone */ }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5 })
})

/** Node runs this stand-in for the "run" subcommand: a new session answers at once, a resume behaves as `resume` says. */
function setup(resume: string) {
  const cwd = mkdtempSync(join(tmpdir(), 'opencode-resume-'))
  roots.push(cwd)
  writeFileSync(join(cwd, 'run'), `
    require('node:fs').readFileSync(0, 'utf8')
    if (!process.argv.includes('-s')) console.log(JSON.stringify({ type: 'step_start', sessionID: 'ses_1' }))
    else { ${resume} }
  `)
  const registry = new TurnRegistry(cwd)
  const cli = new OpenCodeCli(() => process.execPath, 1000, () => process.env, registry)
  const home = { key: 'example', dir: cwd, agent: 'opencode' as const, global: false }
  const start = { name: 'ABC-1', cwd, model: 'example/model', prompt: 'go on' }
  return { cli, home, start, registry }
}

it('takes a resume whose process lives on silently (OpenCode retrying a limit) for resumed, not failed', async () => {
  const { cli, home, start, registry } = setup('setTimeout(() => {}, 60_000)')
  const id = await cli.launch(home, start)
  const started = Date.now()
  expect(await cli.resume(home, id, start)).toBe(id)
  expect(Date.now() - started).toBeLessThan(30_000)
  const pid = (await registry.get(id))!.pid
  pids.push(pid)
  expect(() => process.kill(pid, 0)).not.toThrow()
}, 40_000)

it('fails a resume whose process exits at once, saying it wrote nothing', async () => {
  const { cli, home, start } = setup('process.exit(1)')
  const id = await cli.launch(home, start)
  const error = await cli.resume(home, id, start).catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(NoticeError)
  expect((error as NoticeError).notice).toMatchObject({ code: 'opencode.resumeFailed', detail: 'the opencode process exited with no output' })
}, 40_000)

it('says a process that never wrote was alive and silent, or exited, or failed to start', () => {
  expect(silentTurnDetail({ exited: false, spawnError: '', waitedMs: 120_000 })).toBe('the opencode process was alive but wrote nothing for 120 s')
  expect(silentTurnDetail({ exited: true, spawnError: '', waitedMs: 3_000 })).toBe('the opencode process exited with no output')
  expect(silentTurnDetail({ exited: true, spawnError: 'spawn opencode ENOENT', waitedMs: 0 })).toBe('spawn opencode ENOENT')
})
