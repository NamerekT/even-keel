import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { TurnRegistry } from '../codex/turns.js'
import { OpenCodeCli } from './cli.js'

it('delivers prompts longer than a Windows command line on stdin at launch and resume', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'opencode-input-'))
  try {
    // Node runs this stand-in for the "run" subcommand with the adapter's actual arguments and stdio.
    writeFileSync(join(cwd, 'run'), `
      const fs = require('node:fs')
      const args = process.argv.slice(2)
      const prompt = fs.readFileSync(0, 'utf8')
      fs.writeFileSync('received.json', JSON.stringify({ args, prompt, mark: process.env.EVEN_KEEL_TASK ?? null }))
      console.log(JSON.stringify({ type: 'step_start', sessionID: 'ses_1' }))
    `)
    const cli = new OpenCodeCli(() => process.execPath, 1000, () => process.env, new TurnRegistry(cwd))
    const home = { key: 'example', dir: cwd, agent: 'opencode' as const, global: false }
    const start = { name: 'ABC-1', cwd, model: 'example/model', prompt: '- "café"\n'.repeat(5000), mark: 'project-1/ABC-1' }
    const received = () => JSON.parse(readFileSync(join(cwd, 'received.json'), 'utf8'))
    const id = await cli.launch(home, start)
    expect(received()).toEqual({ args: ['--format', 'json', '-m', 'example/model', '--title', 'ABC-1'], prompt: start.prompt, mark: 'project-1/ABC-1' })

    const reply = `- "Q" → yes\n${start.prompt}`
    expect(await cli.resume(home, id, { ...start, prompt: reply })).toBe(id)
    expect(received()).toEqual({ args: ['--format', 'json', '-m', 'example/model', '-s', id], prompt: reply, mark: 'project-1/ABC-1' })
  } finally {
    rmSync(cwd, { recursive: true, force: true, maxRetries: 5 })
  }
})
