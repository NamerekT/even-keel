import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readToolsView, type ToolsPlaces } from './panel.js'

describe('readToolsView', () => {
  let root: string
  let places: ToolsPlaces

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tools-view-'))
    const globalDir = join(root, '.claude')
    mkdirSync(globalDir)
    writeFileSync(join(globalDir, 'settings.json'), JSON.stringify({ theme: 'dark', env: { TOKEN: 'a' } }))
    const repo = join(root, 'repo')
    mkdirSync(repo)
    places = { repo, globalDir, configs: [], accounts: [], homes: [], trim: false, hidden: [], mode: 'auto' }
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const account = (key: string, agent: string, settings?: Record<string, unknown>) => {
    const dir = join(root, agent, key)
    mkdirSync(dir, { recursive: true })
    if (settings !== undefined) writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings))
    return { key, dir, agent }
  }

  it('compares only Claude accounts with the global settings.json', async () => {
    const accounts = [account('john', 'claude', { theme: 'light', env: { TOKEN: 'a' } }), account('work', 'codex')]
    const view = await readToolsView('ABC', { ...places, accounts })
    expect(view.accounts).toEqual([{ account: 'john', keys: ['theme'] }])
  })

  it('reports every key for a Claude account without settings.json', async () => {
    const view = await readToolsView('ABC', { ...places, accounts: [account('john', 'claude')] })
    expect(view.accounts).toEqual([{ account: 'john', keys: ['env', 'theme'] }])
  })
})
