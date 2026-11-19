import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { CodexCli } from './cli.js'
import type { CodexPlugins } from './plugins.js'
import { TurnRegistry } from './turns.js'

it('delivers prompts longer than a Windows command line on stdin at launch and resume', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'codex-input-'))
  try {
    // Node runs this stand-in for the "exec" subcommand with the adapter's actual arguments and stdio.
    writeFileSync(join(cwd, 'exec'), `
      const fs = require('node:fs')
      const args = process.argv.slice(2)
      const prompt = fs.readFileSync(0, 'utf8')
      fs.writeFileSync('received.json', JSON.stringify({ args, prompt }))
      console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }))
    `)
    const cli = new CodexCli(() => process.execPath, 1000, () => process.env, new TurnRegistry(cwd), {} as CodexPlugins)
    const home = { key: 'example', dir: cwd, agent: 'codex' as const, global: false }
    const start = { name: 'ABC-1', cwd, model: null, prompt: '- "café"\n'.repeat(5000) }
    const received = () => JSON.parse(readFileSync(join(cwd, 'received.json'), 'utf8'))
    const id = await cli.launch(home, start)
    expect(received()).toEqual({ args: ['--json', '--approve-for-me', '-c', 'project_doc_fallback_filenames=["CLAUDE.md"]', '-'], prompt: start.prompt })

    const reply = `Next turn\n${start.prompt}`
    expect(await cli.resume(home, id, { ...start, prompt: reply })).toBe(id)
    expect(received()).toEqual({ args: ['--json', '--approve-for-me', '-c', 'project_doc_fallback_filenames=["CLAUDE.md"]', 'resume', id, '-'], prompt: reply })
  } finally {
    rmSync(cwd, { recursive: true, force: true, maxRetries: 5 })
  }
})
