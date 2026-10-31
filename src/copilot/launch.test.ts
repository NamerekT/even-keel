import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TurnRegistry } from '../codex/turns.js'
import { CopilotCli } from './cli.js'

const cliOutput = vi.hoisted(() => ({ text: '' }))

vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(),
  spawn: (_bin: string, _args: string[], options: { stdio: [string, number, number] }) => {
    writeSync(options.stdio[1], cliOutput.text)
    const child = Object.assign(new EventEmitter(), { pid: 2147483647, unref: () => {} })
    queueMicrotask(() => child.emit('exit', 1))
    return child
  },
}))

describe('Copilot launch without a transcript', () => {
  let dir: string
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  async function launch(output: string) {
    cliOutput.text = output
    dir = mkdtempSync(join(tmpdir(), 'copilot-launch-'))
    const registry = new TurnRegistry(dir)
    const cli = new CopilotCli(() => 'copilot', 1000, () => ({}), registry)
    const home = { key: 'copilot', dir, global: false, agent: 'copilot' }
    const result = cli.launch(home, { name: 'DEMO-1', cwd: dir, model: 'missing-model', prompt: 'DEMO-1' })
    return { result, registry, home }
  }

  it('reports the model fix when the CLI exits before writing any events', async () => {
    const { result, registry, home } = await launch('Error: Model "missing-model" from --model flag is not available.\n')
    await expect(result).rejects.toMatchObject({
      notice: { code: 'copilot.modelUnavailable', params: { model: 'missing-model' } },
    })
    expect(await registry.list(home.key)).toEqual([])
  })

  it('reports the sign-in fix when the CLI exits unauthenticated', async () => {
    const { result } = await launch('Copilot can be authenticated with GitHub using an OAuth Token or a Fine-Grained Personal Access Token.\n\nTo authenticate, you can use any of the following methods:\n  • Run \'gh auth login\' to authenticate with the GitHub CLI\n')
    await expect(result).rejects.toMatchObject({ notice: { code: 'copilot.notSignedIn' } })
  })
})
