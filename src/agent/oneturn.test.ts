import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { runWithInput, stdoutOf } from './oneturn.js'

const run = (script: string) => runWithInput(process.execPath, ['-e', script], '', { cwd: tmpdir(), env: process.env, timeoutMs: 10_000 })

describe('runWithInput', () => {
  it('gives the whole stdout of a run that exited with an error (BTN-1507)', async () => {
    const printed = `{"subtype":"error_max_turns","pad":"${'x'.repeat(800)}"}`
    const error = await run(`process.stdout.write(${JSON.stringify(printed)}); process.exit(1)`).catch((failure: unknown) => failure)
    expect((error as Error).message).toMatch(/^exited with 1: /)
    expect(stdoutOf(error)).toBe(printed)
  })

  it('knows no stdout of another failure', () => {
    expect(stdoutOf(new Error('spawn ENOENT'))).toBeNull()
    expect(stdoutOf(undefined)).toBeNull()
  })
})
