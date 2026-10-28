import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import { copilot } from './adapter.js'

describe('Copilot adapter account access', () => {
  let workDir: string | undefined
  afterEach(() => {
    if (workDir !== undefined) rmSync(workDir, { recursive: true, force: true })
  })

  it('does not use an unverified machine identity for usage or model hints', async () => {
    workDir = mkdtempSync(join(tmpdir(), 'copilot-adapter-'))
    const agent = copilot.setup({
      env: () => ({}),
      timeoutMs: 1000,
      workDir,
      checkedCli: () => false,
      log: () => {},
      onCliChange: () => {},
    })
    const home: AccountHome = { key: 'copilot', dir: workDir, global: false, agent: 'copilot' }
    const usage = agent.usage
    if (usage === undefined) throw new Error('Copilot adapter must expose usage')

    await expect(usage(home, '2026-10-28T00:00:00.000Z')).resolves.toMatchObject({
      kind: 'missing',
      reason: { code: 'usage.copilotMachine' },
    })
    expect(agent.models).toBeUndefined()
  })
})
