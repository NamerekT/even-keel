import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runGit } from '../git/run.js'
import { readBranchDocs, readRepoRules, readToolsView, type ToolsPlaces } from './panel.js'

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
    const git: ToolsPlaces['git'] = async () => ({ code: 128, out: 'not a git repository' })
    places = { repo, branch: 'main', git, globalDir, configs: [], accounts: [], homes: [], trim: false, hidden: [], mode: 'auto', reach: { plugins: [], servers: [] } }
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const account = (key: string, agent: string, settings?: Record<string, unknown>, used = true) => {
    const dir = join(root, agent, key)
    mkdirSync(dir, { recursive: true })
    if (settings !== undefined) writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings))
    return { key, dir, agent, used }
  }

  it('does not compare an account no project runs on', async () => {
    const view = await readToolsView('ABC', { ...places, accounts: [account('api', 'claude', { theme: 'light' }, false)] })
    expect(view.accounts).toEqual([])
  })

  it('leaves out the local-only settings of a package the project does not get', async () => {
    mkdirSync(join(places.repo, '.claude'))
    const local = { enabledPlugins: { 'design@market': true }, permissions: { allow: ['mcp__strata__search', 'mcp__github__get_issue', 'WebFetch'] } }
    writeFileSync(join(places.repo, '.claude', 'settings.local.json'), JSON.stringify(local))
    const view = await readToolsView('ABC', { ...places, reach: { plugins: [], servers: ['github'] } })
    expect(view.settings.filter((row) => row.session === null).map((row) => row.name)).toEqual(['mcp__github__get_issue', 'WebFetch'])
  })

  it('compares only Claude accounts with the global settings.json', async () => {
    const accounts = [account('john', 'claude', { theme: 'light', env: { TOKEN: 'a' } }), account('work', 'codex')]
    const view = await readToolsView('ABC', { ...places, accounts })
    expect(view.accounts).toEqual([{ account: 'john', keys: ['theme'] }])
  })

  it('reports every key for a Claude account without settings.json', async () => {
    const view = await readToolsView('ABC', { ...places, accounts: [account('john', 'claude')] })
    expect(view.accounts).toEqual([{ account: 'john', keys: ['env', 'theme'] }])
  })

  it('has no rules when git cannot read the branch', async () => {
    expect((await readToolsView('ABC', places)).rules).toBeNull()
  })
})

describe('readRepoRules', () => {
  let repo: string
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'repo-rules-'))
  })
  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  it("reads the branch's committed instruction files and skills, not the uncommitted ones", async () => {
    const git = (...args: string[]) => runGit(repo, args)
    await git('init', '-q', '-b', 'trunk')
    writeFileSync(join(repo, 'AGENTS.md'), 'rules')
    mkdirSync(join(repo, '.claude', 'skills', 'review'), { recursive: true })
    writeFileSync(join(repo, '.claude', 'skills', 'review', 'SKILL.md'), 'skill')
    await git('add', '-A')
    await git('-c', 'user.name=John Doe', '-c', 'user.email=john@example.com', 'commit', '-qm', 'rules')
    writeFileSync(join(repo, 'CLAUDE.md'), 'not committed')
    expect(await readRepoRules(runGit, repo, 'trunk')).toEqual({ files: ['AGENTS.md'], skills: [{ folder: '.claude/skills', names: ['review'] }] })
    expect(await readRepoRules(runGit, repo, 'missing')).toBeNull()
  })

  it("lists the branch's committed Markdown files as the documents a standard may name", async () => {
    const git = (...args: string[]) => runGit(repo, args)
    await git('init', '-q', '-b', 'trunk')
    mkdirSync(join(repo, 'docs'), { recursive: true })
    writeFileSync(join(repo, 'docs', 'design.md'), 'look')
    writeFileSync(join(repo, 'README.MD'), 'readme')
    writeFileSync(join(repo, 'index.ts'), 'code')
    await git('add', '-A')
    await git('-c', 'user.name=John Doe', '-c', 'user.email=john@example.com', 'commit', '-qm', 'docs')
    writeFileSync(join(repo, 'notes.md'), 'not committed')
    expect(await readBranchDocs(runGit, repo, 'trunk')).toEqual(['README.MD', 'docs/design.md'])
    expect(await readBranchDocs(runGit, repo, 'missing')).toBeNull()
  })
})
