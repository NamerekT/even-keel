import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { TurnRegistry } from '../codex/turns.js'
import { CopilotCli } from './cli.js'

const standIn = vi.hoisted(() => ({ script: '' }))

// Node runs the stand-in with the adapter's actual arguments and stdio: its first flag, -C, is one of Node's own.
vi.mock('node:child_process', async (original) => {
  const real = await original<typeof import('node:child_process')>()
  return { ...real, spawn: (_bin: string, args: string[], options: object) => real.spawn(process.execPath, [standIn.script, ...args], options) }
})

it('delivers prompts longer than a Windows command line on stdin at launch and resume', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'copilot-input-'))
  try {
    standIn.script = join(cwd, 'copilot.js')
    writeFileSync(standIn.script, `
      const fs = require('node:fs')
      const args = process.argv.slice(2)
      const prompt = fs.readFileSync(0, 'utf8')
      fs.writeFileSync('received.json', JSON.stringify({ args, prompt, mark: process.env.EVEN_KEEL_TASK ?? null }))
      const id = args.find((arg) => arg.startsWith('--resume='))?.slice(9) ?? args[args.indexOf('--session-id') + 1]
      console.log(JSON.stringify({ type: 'result', sessionId: id }))
    `)
    const cli = new CopilotCli(() => 'copilot', 1000, () => process.env, new TurnRegistry(cwd))
    const home = { key: 'example', dir: cwd, agent: 'copilot' as const, global: false }
    const start = { name: 'ABC-1', cwd, model: null, prompt: '- "café"\n'.repeat(5000), mark: 'project-1/ABC-1' }
    const received = () => JSON.parse(readFileSync(join(cwd, 'received.json'), 'utf8'))
    const id = await cli.launch(home, start)
    expect(received()).toMatchObject({ prompt: start.prompt, mark: 'project-1/ABC-1' })
    expect(received().args).toEqual(expect.arrayContaining(['--session-id', id, '--name', 'ABC-1']))

    const reply = `- "Q" → yes\n${start.prompt}`
    expect(await cli.resume(home, id, { ...start, prompt: reply })).toBe(id)
    expect(received()).toMatchObject({ prompt: reply, mark: 'project-1/ABC-1' })
    expect(received().args).toContain(`--resume=${id}`)
    expect(received().args.some((arg: string) => arg.startsWith('--prompt') || arg === '-p')).toBe(false)
  } finally {
    rmSync(cwd, { recursive: true, force: true, maxRetries: 5 })
  }
})
