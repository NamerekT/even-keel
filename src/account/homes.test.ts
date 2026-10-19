import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AccountHomes, assertApiKey } from './homes.js'

const env = {
  PATH: '/bin',
  HULY_URL: 'https://huly.example.com',
  HULY_WORKSPACE: 'ws',
  HULY_EMAIL: 'john@example.com',
  HULY_PASSWORD: 'secret',
}

describe('AccountHomes.addApiKey', () => {
  const key = 'sk-ant-api03-FAKE0000000000000000000000000000-example'

  it("makes a folder whose settings carry the key and whose .claude.json has it approved by its last 20 characters", () => {
    const root = mkdtempSync(join(tmpdir(), 'even-keel-homes-'))
    try {
      const home = new AccountHomes(env, root).addApiKey('Work API', `  ${key}\n`)
      expect(home).toEqual({ key: 'work-api', dir: join(root, 'work-api'), global: false, agent: 'claude' })
      expect(JSON.parse(readFileSync(join(home.dir, 'settings.json'), 'utf8'))).toEqual({ env: { ANTHROPIC_API_KEY: key } })
      const config = JSON.parse(readFileSync(join(home.dir, '.claude.json'), 'utf8'))
      expect(config.customApiKeyResponses).toEqual({ approved: [key.slice(-20)], rejected: [] })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('names the folder "api" without a name and never takes a folder already there', () => {
    const root = mkdtempSync(join(tmpdir(), 'even-keel-homes-'))
    try {
      mkdirSync(join(root, 'api'))
      expect(new AccountHomes(env, root).addApiKey('', key).key).toBe('api-2')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("makes a Codex folder under the Codex root with the key in auth.json as `codex login --with-api-key` writes it", () => {
    const root = mkdtempSync(join(tmpdir(), 'even-keel-homes-'))
    try {
      mkdirSync(join(root, 'claude', 'openai'), { recursive: true })
      const homes = new AccountHomes(env, join(root, 'claude'), join(root, 'codex'))
      const openAi = 'sk-proj-FAKE0000000000000000000000000000-example'
      const home = homes.addApiKey('OpenAI', ` ${openAi}\n`, 'codex')
      expect(home).toEqual({ key: 'openai-2', dir: join(root, 'codex', 'openai-2'), global: false, agent: 'codex' })
      expect(JSON.parse(readFileSync(join(home.dir, 'auth.json'), 'utf8'))).toEqual({ auth_mode: 'apikey', OPENAI_API_KEY: openAi })
      expect(readdirSync(home.dir)).toEqual(['auth.json'])
      expect(homes.apiKeyOf(home)).toBe(openAi)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses a key with spaces inside or too short to approve', () => {
    const homes = new AccountHomes(env, 'root')
    expect(() => homes.addApiKey('api', 'sk-ant short key')).toThrow()
    expect(() => homes.addApiKey('api', 'sk-ant-short')).toThrow()
    expect(() => assertApiKey('sk-ant short key')).toThrow()
    expect(assertApiKey(`  ${key}\n`)).toBe(key)
  })
})

describe('AccountHomes.apiKeyOf', () => {
  it("reads the key from the folder's settings and nothing from a folder without one", () => {
    const root = mkdtempSync(join(tmpdir(), 'even-keel-homes-'))
    try {
      const homes = new AccountHomes(env, root)
      const home = homes.addApiKey('Work API', 'sk-ant-api03-FAKE0000000000000000000000000000-example')
      expect(homes.apiKeyOf(home)).toBe('sk-ant-api03-FAKE0000000000000000000000000000-example')
      mkdirSync(join(root, 'plain'))
      expect(homes.apiKeyOf({ key: 'plain', dir: join(root, 'plain'), global: false, agent: 'claude' })).toBeNull()
      expect(homes.apiKeyOf({ key: 'plain', dir: join(root, 'plain'), global: false, agent: 'codex' })).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('AccountHomes.list', () => {
  it('skips the lock folders the CLI keeps next to an account folder while it refreshes the token', () => {
    const root = mkdtempSync(join(tmpdir(), 'even-keel-homes-'))
    try {
      for (const name of ['john', 'john.lock', '.pending-1', 'global']) mkdirSync(join(root, name))
      const homes = new AccountHomes({ ...env, CLAUDE_CONFIG_DIR: root, CODEX_HOME: join(root, 'no-codex') }, root, join(root, 'no-codex-accounts'))
      expect(homes.list().map((home) => home.key)).toEqual(['global', 'john'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("leaves Claude's own folder out while it does not exist, as Codex's", () => {
    const root = mkdtempSync(join(tmpdir(), 'even-keel-homes-'))
    try {
      mkdirSync(join(root, 'john'))
      const homes = new AccountHomes({ ...env, CLAUDE_CONFIG_DIR: join(root, 'no-claude'), CODEX_HOME: join(root, 'no-codex') }, root, join(root, 'no-codex-accounts'))
      expect(homes.list().map((home) => home.key)).toEqual(['john'])
      expect(homes.find('global')).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('adds the Codex folder once it exists, and no Claude folder takes its key', () => {
    const root = mkdtempSync(join(tmpdir(), 'even-keel-homes-'))
    try {
      for (const name of ['john', 'codex', '.codex']) mkdirSync(join(root, name))
      const homes = new AccountHomes({ ...env, CLAUDE_CONFIG_DIR: root, CODEX_HOME: join(root, '.codex') }, root, join(root, 'no-codex-accounts'))
      expect(homes.list().map((home) => home.key)).toEqual(['global', 'john', 'codex'])
      expect(homes.find('codex')).toEqual({ key: 'codex', dir: join(root, '.codex'), global: true, agent: 'codex' })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("lists the Codex account folders after Codex's own, leaving out locks, sign-ins under way and keys a Claude folder holds", () => {
    const root = mkdtempSync(join(tmpdir(), 'even-keel-homes-'))
    const codexRoot = `${root}-codex`
    try {
      mkdirSync(join(root, 'john'))
      for (const name of ['work', 'john', 'codex', '.pending-1', 'work.lock', 'alice']) mkdirSync(join(codexRoot, name), { recursive: true })
      const homes = new AccountHomes({ ...env, CLAUDE_CONFIG_DIR: root, CODEX_HOME: join(root, 'no-codex') }, root, codexRoot)
      expect(homes.list().map((home) => home.key)).toEqual(['global', 'john', 'alice', 'work'])
      expect(homes.find('work')).toEqual({ key: 'work', dir: join(codexRoot, 'work'), global: false, agent: 'codex' })
      expect(homes.find('john')?.agent).toBe('claude')
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(codexRoot, { recursive: true, force: true })
    }
  })
})

describe('AccountHomes adding a Codex account', () => {
  it("signs in in a folder of its own under the Codex root and names it by the e-mail, apart from every Claude folder", () => {
    const root = mkdtempSync(join(tmpdir(), 'even-keel-homes-'))
    const codexRoot = `${root}-codex`
    try {
      mkdirSync(join(root, 'john'))
      const homes = new AccountHomes({ ...env, CODEX_HOME: join(root, 'no-codex') }, root, codexRoot)
      const pending = homes.pending(new Date('2026-10-17T10:00:00Z'), 'codex')
      expect(pending.agent).toBe('codex')
      expect(existsSync(pending.dir)).toBe(true)
      expect(pending.dir.startsWith(codexRoot)).toBe(true)
      const home = homes.place(pending, 'john@example.com')
      expect(home).toEqual({ key: 'john-2', dir: join(codexRoot, 'john-2'), global: false, agent: 'codex' })
      expect(homes.share(home)).toBe(false)
      expect(readdirSync(home.dir)).toEqual([])
      homes.remove(home)
      expect(existsSync(home.dir)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(codexRoot, { recursive: true, force: true })
    }
  })

  it('refuses an agent it keeps no folders for', () => {
    expect(() => new AccountHomes(env, 'root', 'codex-root').pending(new Date(), 'opencode')).toThrow()
  })
})
