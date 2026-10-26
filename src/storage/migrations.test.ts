import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { root } from '../locations.js'
import { noticeOf } from '../notice/notice.js'
import { writeAtomic } from './atomic.js'
import { upgradeStorage } from './migrations.js'
import { SCHEMA_VERSION } from './schema.js'

describe('upgradeStorage', () => {
  let dir: string
  let stateDir: string
  let configFile: string
  let logs: string[]
  let ids: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'even-keel-storage-'))
    stateDir = join(dir, 'state')
    mkdirSync(stateDir)
    configFile = join(dir, 'even-keel.config.json')
    logs = []
    ids = 0
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const state = (name: string) => join(stateDir, name)
  const put = (file: string, value: unknown) => writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2))
  const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'))
  const text = (file: string) => readFileSync(file, 'utf8')
  const upgrade = (write?: (file: string, text: string) => void) =>
    upgradeStorage({ configFile, stateDir, log: (line) => logs.push(line), newId: () => `guid-${++ids}`, write })
  const codeOf = (run: () => void) => {
    try {
      run()
    } catch (error) {
      return noticeOf(error).code
    }
    return undefined
  }

  const ABC_ENTRY = { id: 'id-abc', key: 'ABC', repo: 'C:\\abc' }
  const XYZ_ENTRY = { id: 'id-xyz', key: 'XYZ', repo: 'C:\\xyz' }
  const v1Config = { language: 'en', projects: { ABC: 'C:\\abc', XYZ: { repo: 'C:\\xyz', name: 'Xyz', slot: 2 } } }
  const v1Chain = {
    active: [{ project: 'ABC', current: null, paused: false, error: null }],
    queue: ['XYZ'],
    orders: { ABC: ['ABC-1', 'ABC-2'], XYZ: ['XYZ-3'] },
    skipped: { ABC: ['ABC-9'] },
    leftovers: { XYZ: [{ task: 'XYZ-1', at: '2026-10-01T00:00:00.000Z', notice: { code: 'text', params: { text: 'dirty' } } }] },
    released: { ABC: ['ABC-5'] },
    unattended: false,
    trimTools: true,
    ci: { ABC: { green: 'abc123', fix: { task: 'ABC-FIX', at: '2026-10-01T00:00:00.000Z', commit: 'def456' } } },
  }
  const v1Questions = [{ task: 'ABC-1', sessionId: 's1', ask: 'a1', comment: 'c1' }]
  const v1Launches = [
    { at: '2026-10-01T00:00:00.000Z', project: 'ABC', task: 'ABC-1', sessionId: 's1' },
    { at: '2026-10-02T00:00:00.000Z', project: 'XYZ', task: 'XYZ-3', sessionId: 's2', reason: 'restart' },
  ]
  const v1Account = { active: 'global', accounts: {}, removing: [] }

  const putV1 = () => {
    put(configFile, v1Config)
    put(state('chain.json'), v1Chain)
    put(state('questions.json'), v1Questions)
    put(state('launches.jsonl'), v1Launches.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
    put(state('account.json'), v1Account)
  }
  const originals = () => ['even-keel.config.json', 'state/chain.json', 'state/questions.json', 'state/launches.jsonl', 'state/account.json'].map((name) => text(join(dir, name)))

  describe('v1 to v2', () => {
    it('turns the projects object into an array of records in the same order, each with a GUID', () => {
      putV1()
      upgrade()
      const config = json(configFile)
      expect(Object.keys(config)[0]).toBe('version')
      expect(config).toEqual({
        version: SCHEMA_VERSION,
        language: 'en',
        projects: [
          { id: 'guid-1', key: 'ABC', repo: 'C:\\abc', tracker: 'huly' },
          { id: 'guid-2', key: 'XYZ', repo: 'C:\\xyz', name: 'Xyz', slot: 2, tracker: 'huly' },
        ],
      })
    })

    it('names the projects of chain.json by their ids', () => {
      putV1()
      upgrade()
      const chain = json(state('chain.json'))
      expect(chain.version).toBe(SCHEMA_VERSION)
      expect(chain.active[0].project).toBe('guid-1')
      expect(chain.queue).toEqual(['guid-2'])
      expect(Object.keys(chain.orders)).toEqual(['guid-1', 'guid-2'])
      expect(chain.orders['guid-1']).toEqual(['ABC-1', 'ABC-2'])
      expect(Object.keys(chain.skipped)).toEqual(['guid-1'])
      expect(Object.keys(chain.leftovers)).toEqual(['guid-2'])
      expect(Object.keys(chain.released)).toEqual(['guid-1'])
      expect(chain.ci).toEqual({ 'guid-1': v1Chain.ci.ABC })
    })

    it('wraps the questions, rewrites the launches with ids under a version line and stamps the account file', () => {
      putV1()
      upgrade()
      expect(json(state('questions.json'))).toEqual({ version: SCHEMA_VERSION, questions: v1Questions })
      const lines = text(state('launches.jsonl')).trim().split('\n').map((line) => JSON.parse(line))
      expect(lines).toEqual([{ version: SCHEMA_VERSION }, { ...v1Launches[0], project: 'guid-1' }, { ...v1Launches[1], project: 'guid-2' }])
      const { active: _active, ...account } = v1Account
      expect(json(state('account.json'))).toEqual({ version: SCHEMA_VERSION, ...account })
    })

    it('keeps a copy of every file it rewrites and says so in the log', () => {
      putV1()
      const before = originals()
      upgrade()
      const copies = ['even-keel.config.json', 'state/chain.json', 'state/questions.json', 'state/launches.jsonl', 'state/account.json'].map((name) =>
        text(join(dir, `${name}.v1.bak`)),
      )
      expect(copies).toEqual(before)
      expect(logs).toHaveLength(5)
      expect(logs[0]).toContain('v1')
    })

    it('migrates the files that are there and leaves out the missing ones', () => {
      put(configFile, v1Config)
      upgrade()
      expect(json(configFile).version).toBe(SCHEMA_VERSION)
      expect(existsSync(state('chain.json'))).toBe(false)
      expect(existsSync(state('launches.jsonl'))).toBe(false)
    })

    it('stamps a config that already has the projects array', () => {
      put(configFile, { projects: [{ id: 'id-abc', key: 'ABC', repo: 'C:\\abc' }] })
      put(state('chain.json'), { ...v1Chain, active: [], queue: [], orders: { ABC: [] }, skipped: {}, leftovers: {}, released: {}, ci: {} })
      upgrade()
      expect(json(configFile)).toEqual({ version: SCHEMA_VERSION, projects: [{ id: 'id-abc', key: 'ABC', repo: 'C:\\abc', tracker: 'huly' }] })
      expect(json(state('chain.json')).orders).toEqual({ 'id-abc': [] })
    })

    it('does nothing the second time', () => {
      putV1()
      upgrade()
      const after = originals()
      logs = []
      upgrade()
      expect(originals()).toEqual(after)
      expect(logs).toEqual([])
    })
  })

  // v2 → v3 (the launch log's fix entries), v3 → v4 (the name of an account), v4 → v5 (`commands.afterGreen` and its
  // mark in the chain's `ci`), v5 → v6 (a project's agent, Codex sessions) and v6 → v7 (the bypass of the Codex sandbox)
  // only add optional fields, so each step only stamps the files. v7 → v8 (BTN-173) moves the run settings of the config
  // into maps by provider — the samples of v6 and v7 have them, see below — and the active account out of `account.json`.
  // v8 → v9 (BTN-174) adds the new file `state/packages.json` and stamps the others. v9 → v10 (BTN-239) stamps them for
  // an account's optional `transport`; v10 → v11 (BTN-302) writes `bg` to each account without one; v11 → v12 (BTN-353)
  // moves the accounts' transports into `transports`, waiting for the service to make them `execution.claude`; v12 → v13
  // (BTN-345) moves the shared `tracker` of the config into its projects, see below.
  describe.each([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])('v%i to the current version', (from) => {
    const sample = join(root, 'test', 'fixtures', `schema-v${from}`)
    const names = ['even-keel.config.json', 'state/chain.json', 'state/questions.json', 'state/launches.jsonl', 'state/account.json']

    it('stamps every file with the new version and changes nothing else', async () => {
      await cp(sample, dir, { recursive: true })
      const before = originals()
      upgrade()
      for (const name of names.filter((each) => each.endsWith('.json'))) {
        const { version, ...rest } = json(join(dir, name))
        expect(version).toBe(SCHEMA_VERSION)
        const { version: _, ...old } = JSON.parse(readFileSync(join(sample, name), 'utf8'))
        if (name === 'state/account.json') {
          delete old.active
          const transports: Record<string, unknown> = {}
          for (const [key, record] of Object.entries<Record<string, unknown>>(old.accounts)) {
            const transport = record.transport ?? (from < 11 ? 'bg' : undefined)
            if (transport !== undefined) transports[key] = transport
            delete record.transport
          }
          if (Object.keys(transports).length > 0) old.transports = transports
        }
        if (name === 'even-keel.config.json') {
          old.projects = old.projects.map((entry: Record<string, unknown>) => ({ ...entry, tracker: entry.tracker ?? old.tracker }))
          delete old.tracker
        }
        if (name !== 'even-keel.config.json' || from < 6) expect(rest).toEqual(old)
      }
      const lines = text(state('launches.jsonl')).split('\n')
      expect(lines[0]).toBe(`{"version":${SCHEMA_VERSION}}`)
      expect(lines.slice(1).join('\n')).toBe(before[3]!.split('\n').slice(1).join('\n'))
      expect(names.map((name) => text(join(dir, `${name}.v${from}.bak`)))).toEqual(before)
    })
  })

  describe('v7 to v8', () => {
    const sample = join(root, 'test', 'fixtures', 'schema-v7')

    it('moves agent, codexModel and the shared model into maps by provider and the bypass of the sandbox into the shared execution', async () => {
      await cp(sample, dir, { recursive: true })
      put(configFile, { ...json(configFile), model: 'sonnet' })
      upgrade()
      const config = json(configFile)
      expect(config).toMatchObject({ version: SCHEMA_VERSION, models: { claude: 'sonnet' }, execution: { codex: 'bypass' } })
      expect(config.model).toBeUndefined()
      expect(config.projects[0]).toEqual({ ...json(join(sample, 'even-keel.config.json')).projects[0], tracker: 'huly' })
      expect(config.projects[1]).toEqual({
        id: '22222222-2222-4222-8222-222222222222',
        key: 'XYZ',
        name: 'Other project',
        repo: 'C:\\repos\\other-project',
        branch: 'master',
        slot: 2,
        provider: 'codex',
        models: { codex: 'gpt-5.6-luna' },
        tracker: 'huly',
      })
    })

    it('moves the active account of the account file into the config, the global folder being the default', async () => {
      await cp(sample, dir, { recursive: true })
      put(state('account.json'), { ...json(state('account.json')), active: 'team-api' })
      upgrade()
      expect(json(configFile).accounts).toEqual({ claude: 'team-api' })
      expect(json(state('account.json')).active).toBeUndefined()
    })

    it('leaves the sandbox on and writes no account while no project bypassed it and the global folder was active', () => {
      put(configFile, { version: 7, projects: [{ id: 'id-abc', key: 'ABC', repo: 'C:\\abc', codexBypassSandbox: false }] })
      put(state('account.json'), { version: 7, active: 'global', accounts: {}, removing: [] })
      upgrade()
      expect(json(configFile)).toEqual({ version: SCHEMA_VERSION, projects: [{ id: 'id-abc', key: 'ABC', repo: 'C:\\abc', tracker: 'huly' }] })
    })
  })

  describe('v10 to v11', () => {
    const accounts = {
      global: { email: 'john.doe@example.com', since: null, previous: null, transport: 'sdk' },
      'team-api': { email: 'team-api', since: null, previous: null, name: 'Team API' },
      codex: { email: 'jane.doe@example.com', since: null, previous: null },
    }

    it('writes --bg to each account without a chosen transport, keeps a choice and leaves the Codex folder alone', () => {
      put(state('account.json'), { version: 10, accounts, removing: [] })
      upgrade()
      const { transport: _, ...global } = accounts.global
      expect(json(state('account.json'))).toEqual({
        version: SCHEMA_VERSION,
        accounts: { ...accounts, global },
        removing: [],
        transports: { global: 'sdk', 'team-api': 'bg' },
      })
    })

    it('writes it to the accounts of an account file older than v8 too', () => {
      put(state('account.json'), { version: 7, active: 'global', accounts: { global: accounts['team-api'] }, removing: [] })
      upgrade()
      expect(json(state('account.json'))).toMatchObject({ accounts: { global: accounts['team-api'] }, transports: { global: 'bg' } })
    })
  })

  describe('v11 to v12', () => {
    it('moves the transport of each account that has one into transports and drops what is no transport', () => {
      const accounts = {
        global: { email: 'john.doe@example.com', since: null, previous: null, transport: 'sdk' },
        'team-api': { email: 'team-api', since: null, previous: null, name: 'Team API', transport: 'pipe' },
        'work-api': { email: 'work-api', since: null, previous: null },
      }
      put(state('account.json'), { version: 11, accounts, removing: ['work-api'] })
      upgrade()
      expect(json(state('account.json'))).toEqual({
        version: SCHEMA_VERSION,
        accounts: { global: { email: 'john.doe@example.com', since: null, previous: null }, 'team-api': { email: 'team-api', since: null, previous: null, name: 'Team API' }, 'work-api': accounts['work-api'] },
        removing: ['work-api'],
        transports: { global: 'sdk' },
      })
    })

    it('writes no transports when no account chose one', () => {
      put(state('account.json'), { version: 11, accounts: { global: { email: null, since: null, previous: null } }, removing: [] })
      upgrade()
      expect(json(state('account.json'))).toEqual({ version: SCHEMA_VERSION, accounts: { global: { email: null, since: null, previous: null } }, removing: [] })
    })
  })

  describe('v12 to v13', () => {
    it('gives each project without a tracker of its own the shared one and drops the shared key', () => {
      put(configFile, { version: 12, tracker: 'linear', projects: [ABC_ENTRY, { ...XYZ_ENTRY, tracker: 'github', github: 'octo-org/xyz' }] })
      upgrade()
      expect(json(configFile)).toEqual({ version: SCHEMA_VERSION, projects: [{ ...ABC_ENTRY, tracker: 'linear' }, { ...XYZ_ENTRY, tracker: 'github', github: 'octo-org/xyz' }] })
    })

    it('gives them Huly, the default of then, when the config named no shared tracker', () => {
      put(configFile, { version: 12, projects: [ABC_ENTRY] })
      upgrade()
      expect(json(configFile)).toEqual({ version: SCHEMA_VERSION, projects: [{ ...ABC_ENTRY, tracker: 'huly' }] })
    })
  })

  it('gives an id to an entry of the current version added by hand and writes nothing else', () => {
    put(configFile, { version: SCHEMA_VERSION, projects: [{ id: 'id-abc', key: 'ABC', repo: 'C:\\abc', tracker: 'huly' }, { key: 'NEW', repo: 'C:\\new', tracker: 'huly' }] })
    upgrade()
    expect(json(configFile).projects[1]).toEqual({ id: 'guid-1', key: 'NEW', repo: 'C:\\new', tracker: 'huly' })
    expect(logs).toEqual([`storage: gave an id to the projects of ${configFile} without one, the previous file is kept at ${configFile}.v${SCHEMA_VERSION}.bak`])
  })

  describe('writes nothing', () => {
    it('when any file is newer than the code', () => {
      putV1()
      put(state('account.json'), { version: SCHEMA_VERSION + 1, active: 'global', accounts: {}, removing: [] })
      const before = originals()
      expect(codeOf(upgrade)).toBe('storage.newer')
      expect(originals()).toEqual(before)
      expect(existsSync(`${configFile}.v1.bak`)).toBe(false)
    })

    it('when the packages file is newer than the code', () => {
      putV1()
      put(state('packages.json'), { version: SCHEMA_VERSION + 1, packages: {}, projects: {}, pins: {} })
      expect(codeOf(upgrade)).toBe('storage.newer')
      expect(json(configFile)).toEqual(v1Config)
    })

    it('when the launches log is newer than the code', () => {
      putV1()
      put(state('launches.jsonl'), `{"version":${SCHEMA_VERSION + 1}}\n`)
      expect(codeOf(upgrade)).toBe('storage.newer')
      expect(json(configFile)).toEqual(v1Config)
    })

    it('when a state file names a project the config does not have', () => {
      putV1()
      put(state('chain.json'), { ...v1Chain, queue: ['XYZ', 'OLD'] })
      const before = originals()
      expect(codeOf(upgrade)).toBe('storage.unknownProject')
      expect(originals()).toEqual(before)
    })

    it('when a launch names a project the config does not have', () => {
      putV1()
      put(state('launches.jsonl'), JSON.stringify({ ...v1Launches[0], project: 'OLD' }) + '\n')
      expect(codeOf(upgrade)).toBe('storage.unknownProject')
      expect(json(configFile)).toEqual(v1Config)
    })

    it('when a file is not JSON', () => {
      putV1()
      put(state('chain.json'), '{ "active": ')
      expect(codeOf(upgrade)).toBe('storage.damaged')
      expect(json(configFile)).toEqual(v1Config)
    })

    it('when the config is broken', () => {
      putV1()
      put(configFile, { projects: { 'not a key': 'C:\\abc' } })
      expect(codeOf(upgrade)).toBe('config.projectKey')
      expect(existsSync(state('chain.json.v1.bak'))).toBe(false)
    })
  })

  it('puts back the files it wrote when a write fails midway', () => {
    putV1()
    const before = originals()
    let writes = 0
    const failing = (file: string, body: string) => {
      if (++writes === 3) throw new Error('disk full')
      writeAtomic(file, body)
    }
    expect(codeOf(() => upgrade(failing))).toBe('storage.writeFailed')
    expect(originals()).toEqual(before)
  })
})
