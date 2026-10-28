import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AccountHomes, assertApiKey, keyProvider } from './homes.js'

const env = {
  PATH: '/bin',
  HULY_URL: 'https://huly.example.com',
  HULY_WORKSPACE: 'ws',
  HULY_EMAIL: 'john@example.com',
  HULY_PASSWORD: 'secret',
  EVEN_KEEL_OPENCODE_ACCOUNTS_DIR: join(tmpdir(), 'even-keel-homes-no-opencode'),
  EVEN_KEEL_COPILOT_ACCOUNTS_DIR: join(tmpdir(), 'even-keel-homes-no-copilot'),
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
      expect(homes.list().map((home) => home.key)).toEqual(['john'])
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

  it('adds a global Codex folder explicitly, and no Claude folder takes its key', async () => {
    const root = mkdtempSync(join(tmpdir(), 'even-keel-homes-'))
    try {
      for (const name of ['john', 'codex', '.codex']) mkdirSync(join(root, name))
      const homes = new AccountHomes({ ...env, CLAUDE_CONFIG_DIR: root, CODEX_HOME: join(root, '.codex') }, root, join(root, 'no-codex-accounts'))
      for (const home of homes.availableGlobals()) await homes.register(home)
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
      expect(homes.list().map((home) => home.key)).toEqual(['john', 'alice', 'work'])
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
    expect(() => new AccountHomes(env, 'root', 'codex-root').pending(new Date(), 'gemini')).toThrow()
  })
})

describe('AccountHomes OpenCode accounts', () => {
  it('lists them last, apart from the Claude and Codex keys, and places a sign-in under the OpenCode root', () => {
    const root = mkdtempSync(join(tmpdir(), 'even-keel-homes-'))
    const codexRoot = `${root}-codex`
    const openCodeRoot = `${root}-opencode`
    try {
      mkdirSync(join(root, 'john'))
      mkdirSync(join(codexRoot, 'work'), { recursive: true })
      for (const name of ['john', 'work', 'zen', '.pending-1']) mkdirSync(join(openCodeRoot, name), { recursive: true })
      const homes = new AccountHomes({ ...env, CLAUDE_CONFIG_DIR: join(root, 'no-claude'), CODEX_HOME: join(root, 'no-codex') }, root, codexRoot, openCodeRoot)
      expect(homes.list().map((home) => `${home.agent}:${home.key}`)).toEqual(['claude:john', 'codex:work', 'opencode:zen'])
      const home = homes.place(homes.pending(new Date('2026-10-22T10:00:00Z'), 'opencode'), null)
      expect(home).toMatchObject({ dir: join(openCodeRoot, home.key), global: false, agent: 'opencode' })
      expect(homes.share(home)).toBe(false)
    } finally {
      for (const dir of [root, codexRoot, openCodeRoot]) rmSync(dir, { recursive: true, force: true })
    }
  })

  it("keeps an API key in OpenCode's auth.json under the provider the key is of", () => {
    const root = mkdtempSync(join(tmpdir(), 'even-keel-homes-'))
    try {
      const homes = new AccountHomes(env, join(root, 'claude'), join(root, 'codex'), join(root, 'opencode'))
      const anthropic = 'sk-ant-fake.example.com.0000'
      const home = homes.addApiKey('Zen', anthropic, 'opencode')
      expect(home).toEqual({ key: 'zen', dir: join(root, 'opencode', 'zen'), global: false, agent: 'opencode' })
      expect(JSON.parse(readFileSync(join(home.dir, 'data', 'opencode', 'auth.json'), 'utf8'))).toEqual({ anthropic: { type: 'api', key: anthropic } })
      expect(homes.apiKeyOf(home)).toBe(anthropic)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('AccountHomes Copilot accounts', () => {
  const token = 'github_pat_11AAAAAAA0fake0example'

  it('lists them after OpenCode and places a folder without a token under the Copilot root', () => {
    const root = mkdtempSync(join(tmpdir(), 'even-keel-homes-'))
    const copilotRoot = join(root, 'copilot')
    try {
      for (const name of ['work', 'github', '.pending-1']) mkdirSync(join(copilotRoot, name), { recursive: true })
      const homes = new AccountHomes(
        { ...env, CLAUDE_CONFIG_DIR: join(root, 'no-claude'), CODEX_HOME: join(root, 'no-codex') },
        join(root, 'claude'),
        join(root, 'codex'),
        join(root, 'opencode'),
        copilotRoot,
      )
      mkdirSync(join(root, 'opencode', 'work'), { recursive: true })
      expect(homes.list().map((home) => `${home.agent}:${home.key}`)).toEqual(['opencode:work', 'copilot:github'])
      const home = homes.place(homes.pending(new Date('2026-10-22T10:00:00Z'), 'copilot'), 'copilot')
      expect(home).toMatchObject({ key: 'copilot', dir: join(copilotRoot, 'copilot'), agent: 'copilot' })
      expect(homes.share(home)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps a GitHub token in the folder as its key', () => {
    const root = mkdtempSync(join(tmpdir(), 'even-keel-homes-'))
    try {
      const homes = new AccountHomes(env, join(root, 'claude'), join(root, 'codex'), join(root, 'opencode'), join(root, 'copilot'))
      const home = homes.addApiKey('', ` ${token}\n`, 'copilot')
      expect(home).toEqual({ key: 'github', dir: join(root, 'copilot', 'github'), global: false, agent: 'copilot' })
      expect(homes.apiKeyOf(home)).toBe(token)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses a classic token, which the CLI does not take', () => {
    expect(() => assertApiKey('ghp_0000000000fake0example0000', 'copilot')).toThrow(expect.objectContaining({ notice: expect.objectContaining({ code: 'account.copilotTokenInvalid' }) }))
    expect(assertApiKey(`${token} `, 'copilot')).toBe(token)
    expect(keyProvider('copilot', token)).toBe('github')
  })
})

describe('AccountHomes.replaceApiKey (BTN-418)', () => {
  const old = 'sk-ant-api03-FAKE0000000000000000000000000000-oldkey'
  const next = 'sk-ant-api03-FAKE1111111111111111111111111111-newkey'
  const withRoot = (run: (root: string, homes: AccountHomes) => void) => {
    const root = mkdtempSync(join(tmpdir(), 'even-keel-homes-'))
    try {
      run(root, new AccountHomes(env, join(root, 'claude'), join(root, 'codex'), join(root, 'opencode'), join(root, 'copilot')))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
  const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'))

  it("puts Claude's new key into settings.json and approves it in place of the old one, keeping the rest", () =>
    withRoot((_root, homes) => {
      const home = homes.addApiKey('Work', old)
      const settings = join(home.dir, 'settings.json')
      const config = join(home.dir, '.claude.json')
      writeFileSync(settings, JSON.stringify({ model: 'opus', env: { ANTHROPIC_API_KEY: old, OTHER: '1' } }))
      writeFileSync(config, JSON.stringify({ numStartups: 3, customApiKeyResponses: { approved: ['someone-else-0000000', old.slice(-20)], rejected: ['refused-000000000000'] } }))
      homes.replaceApiKey(home, ` ${next}\n`)
      expect(json(settings)).toEqual({ model: 'opus', env: { ANTHROPIC_API_KEY: next, OTHER: '1' } })
      expect(json(config)).toEqual({ numStartups: 3, customApiKeyResponses: { approved: ['someone-else-0000000', next.slice(-20)], rejected: ['refused-000000000000'] } })
      expect(homes.apiKeyOf(home)).toBe(next)
    }))

  it("puts Codex's into auth.json and OpenCode's under the same provider, keeping the rest", () =>
    withRoot((_root, homes) => {
      const codex = homes.addApiKey('', 'sk-proj-fake-0000000000000000-old', 'codex')
      const auth = join(codex.dir, 'auth.json')
      writeFileSync(auth, JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-fake-0000000000000000-old', last_refresh: null }))
      homes.replaceApiKey(codex, 'sk-proj-fake-0000000000000000-new')
      expect(json(auth)).toEqual({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-fake-0000000000000000-new', last_refresh: null })

      const openCode = homes.addApiKey('Zen', 'sk-ant-fake.example.com.0000', 'opencode')
      const file = join(openCode.dir, 'data', 'opencode', 'auth.json')
      writeFileSync(file, JSON.stringify({ anthropic: { type: 'api', key: 'sk-ant-fake.example.com.0000' }, github: { type: 'oauth', refresh: 'x' } }))
      homes.replaceApiKey(openCode, 'sk-ant-fake.example.com.1111')
      expect(json(file)).toEqual({ anthropic: { type: 'api', key: 'sk-ant-fake.example.com.1111' }, github: { type: 'oauth', refresh: 'x' } })
    }))

  it("refuses an OpenCode key of another provider than the account's, and writes nothing", () =>
    withRoot((_root, homes) => {
      const home = homes.addApiKey('Zen', 'sk-ant-fake.example.com.0000', 'opencode')
      expect(() => homes.replaceApiKey(home, 'sk-proj-fake-0000000000000000-new')).toThrow(
        expect.objectContaining({ notice: expect.objectContaining({ code: 'account.keyOtherProvider' }) }),
      )
      expect(homes.apiKeyOf(home)).toBe('sk-ant-fake.example.com.0000')
    }))

  it('refuses a malformed key as adding does, and a folder that holds no key of its own', () =>
    withRoot((root, homes) => {
      const home = homes.addApiKey('Work', old)
      expect(() => homes.replaceApiKey(home, 'too short')).toThrow(expect.objectContaining({ notice: expect.objectContaining({ code: 'account.apiKeyInvalid' }) }))
      const helper = join(root, 'claude', 'helper')
      mkdirSync(helper)
      writeFileSync(join(helper, 'settings.json'), JSON.stringify({ apiKeyHelper: 'get-key.sh' }))
      expect(() => homes.replaceApiKey({ key: 'helper', dir: helper, global: false, agent: 'claude' }, next)).toThrow(
        expect.objectContaining({ notice: expect.objectContaining({ code: 'account.keyNotHeld' }) }),
      )
      expect(() => homes.replaceApiKey({ ...home, global: true }, next)).toThrow(expect.objectContaining({ notice: expect.objectContaining({ code: 'account.keyNotHeld' }) }))
      expect(homes.apiKeyOf(home)).toBe(old)
    }))
})
