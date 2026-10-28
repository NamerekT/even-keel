import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { AccountHomes } from './homes.js'

it('discovers existing global history independently of account registration', async () => {
  const root = mkdtempSync(join(tmpdir(), 'account-discovery-'))
  try {
    const env = { CLAUDE_CONFIG_DIR: join(root, '.claude'), CODEX_HOME: join(root, '.codex') }
    const homes = new AccountHomes(env, join(root, 'claude'), join(root, 'codex'), join(root, 'opencode'), join(root, 'copilot'))
    expect(homes.all()).toEqual([])
    for (const path of [env.CLAUDE_CONFIG_DIR, env.CODEX_HOME, join(root, 'claude', 'work'), join(root, 'codex', 'work-codex')]) {
      mkdirSync(path, { recursive: true })
    }
    expect(homes.all().map((home) => home.key).sort()).toEqual(['codex', 'global', 'work', 'work-codex'])
    expect(homes.find('global')).toBeUndefined()
    expect(homes.list().map((home) => home.key)).toEqual(['work', 'work-codex'])
    await homes.register(homes.global)
    expect(homes.all().filter((home) => home.key === 'global')).toHaveLength(1)
    expect(homes.find('global')).toEqual(homes.global)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
